import type { Page } from "playwright";
import type { FormField, ParsedForm, PlannedField } from "../types.js";
import type { ProfileData } from "../../types.js";
import { answerFormField } from "../../llm/claude.js";
import { getIndeedContext, closeIndeedBrowser } from "../../sources/indeed.js";

/**
 * Heuristic fallback for required fields Claude couldn't answer.
 * Same shape as the Greenhouse applier's fallback.
 */
function fallbackValueFor(field: FormField): any {
  const label = (field.label || "").toLowerCase();
  const desc = (field.description || "").toLowerCase();
  const blob = `${label} ${desc}`;

  const isYears =
    /year[s]?\s*(of\s+)?(hands[- ]on\s+)?(experience|exp)/.test(blob) ||
    /how\s+(many|much)\s+year/.test(blob) ||
    /how\s+long.*(worked|experience)/.test(blob);
  if (isYears || field.type === "number") return 2;

  if (field.type === "yes_no" && field.options && field.options.length > 0) {
    const wantsYes = /authoriz|eligible|willing|able to|legally|us citizen|over\s*18/.test(blob);
    const target = wantsYes ? "yes" : "no";
    const hit = field.options.find(
      (o) => o.label.toLowerCase().includes(target) || o.value.toLowerCase().includes(target)
    );
    return hit ? hit.value : field.options[0].value;
  }

  if (field.type === "select" && field.options && field.options.length > 0) {
    const real = field.options.find((o) => {
      const t = o.label.toLowerCase().trim();
      return o.value && t && !t.startsWith("select") && !t.startsWith("choose");
    });
    if (real) return real.value;
  }
  return null;
}

interface SessionRecord {
  page: Page;
  jobUrl: string;
  external: boolean; // true if Indeed redirects to a 3rd-party site
}
const _sessions = new Map<string, SessionRecord>();

export async function closeBrowser(): Promise<void> {
  await closeIndeedBrowser();
}

/**
 * Open the Indeed job view, click "Apply now", and parse the first apply step
 * into our ParsedForm shape. If Indeed routes us off-platform (external apply),
 * we mark the session so the user knows the bot can't fill it.
 */
export async function openIndeedJob(jobUrl: string, applicationId: string): Promise<ParsedForm> {
  const ctx = await getIndeedContext();
  const pages = ctx.pages();
  const page = pages.length > 0 ? pages[pages.length - 1] : await ctx.newPage();
  await page.bringToFront().catch(() => undefined);

  if (!page.url().includes("/viewjob") || !page.url().includes(extractJk(jobUrl))) {
    await page.goto(jobUrl, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
  }
  await waitForCloudflare(page);
  await page.waitForTimeout(1500);

  // Click "Apply now" — Indeed uses several different selectors over time.
  const applyBtn = page
    .locator(
      [
        "button[id^='indeedApplyButton']",
        "button:has-text('Apply now')",
        "a:has-text('Apply now')",
        "button:has-text('Apply on company site')",
        "a:has-text('Apply on company site')",
        "[data-testid='IndeedApplyButton']",
      ].join(", ")
    )
    .first();

  let external = false;
  const btnText = (await applyBtn.textContent().catch(() => ""))?.toLowerCase() || "";
  if (btnText.includes("company site")) {
    external = true;
    console.log("[indeed] external-apply job — opening company site for manual apply");
    // Open in same tab so the user can finish; we won't try to fill.
    await applyBtn.click().catch(() => undefined);
    await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => undefined);
  } else if (await applyBtn.isVisible().catch(() => false)) {
    await applyBtn.click().catch(() => undefined);
    await page.waitForTimeout(2000);
    // SmartApply often loads in the same tab or a new tab.
    await syncWithSmartApplyTab(ctx, page).catch(() => undefined);
  } else {
    console.log("[indeed] no apply button found — page may be already on apply form");
  }

  // After click, page should be on smartapply.indeed.com/* if it's an Indeed-hosted form.
  const finalPage = await activeIndeedPage(ctx, page);
  _sessions.set(applicationId, { page: finalPage, jobUrl, external });

  if (external) {
    return {
      source: "indeed" as any,
      jobBoardToken: "indeed",
      jobId: jobUrl,
      applyUrl: finalPage.url(),
      fields: [],
    };
  }

  // Wait for the SmartApply form to render.
  await finalPage
    .waitForSelector("form, [data-testid='ia-FormFields'], input, textarea, button[type='submit']", {
      timeout: 20_000,
    })
    .catch(() => undefined);
  await finalPage.waitForTimeout(800);

  const fields = await extractFieldsFromPage(finalPage);
  console.log(`[indeed] plan: extracted ${fields.length} fields from ${finalPage.url()}`);
  for (const f of fields) {
    console.log(
      `[indeed]   - id="${f.id}" label="${f.label}" type=${f.type} req=${f.required} current="${f.currentValue ?? ""}"`
    );
  }

  return {
    source: "indeed" as any,
    jobBoardToken: "indeed",
    jobId: jobUrl,
    applyUrl: finalPage.url(),
    fields,
  };
}

/**
 * Fill planned values into the Indeed SmartApply form. SmartApply is a
 * multi-step wizard: each "Continue" reveals new fields. We loop:
 *   1. extract fields on current step
 *   2. fill what we can
 *   3. click Continue
 *   4. stop when we hit the Review/Submit step
 * The user clicks the final Submit themselves.
 */
export async function fillIndeedForm(
  applicationId: string,
  values: PlannedField[],
  profile: ProfileData,
  context: { jobTitle: string; jobCompany: string; jobDescription: string },
  resumeAbsPath?: string
): Promise<{ filled: string[]; skipped: { id: string; reason: string }[]; reviewUrl: string }> {
  const sess = _sessions.get(applicationId);
  if (!sess) throw new Error("No active Indeed session — plan first.");
  if (sess.external) {
    return {
      filled: [],
      skipped: [{ id: "_external", reason: "Job redirects to the company's own site — apply manually in the browser." }],
      reviewUrl: sess.page.url(),
    };
  }
  const page = sess.page;

  const filled: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  const valuesByLabel = new Map<string, PlannedField>();
  const valuesById = new Map<string, PlannedField>();
  for (const v of values) {
    valuesByLabel.set(v.label.toLowerCase(), v);
    valuesById.set(v.id, v);
  }

  const MAX_STEPS = 10;
  for (let step = 0; step < MAX_STEPS; step++) {
    console.log(`[indeed] ==== step ${step + 1} (${page.url()}) ====`);

    const stepFields = await extractFieldsFromPage(page);
    if (stepFields.length === 0) {
      console.log(`[indeed]   no fields found — likely review/submit step`);
      break;
    }

    for (const f of stepFields) {
      const cur = f.currentValue ? String(f.currentValue).trim() : "";
      console.log(
        `[indeed]   field id="${f.id}" label="${f.label}" type=${f.type} req=${f.required} current="${cur}"`
      );
      if (cur !== "") {
        console.log(`[indeed]     -> SKIP (already filled)`);
        continue;
      }

      // Resume / file fields
      if (f.type === "file") {
        if (!resumeAbsPath) {
          skipped.push({ id: f.id, reason: "No resume PDF uploaded in profile" });
          console.log(`[indeed]     -> SKIP (no resume PDF)`);
          continue;
        }
        try {
          const fileInput = page.locator(`#${cssEscape(f.id)}`).first();
          await fileInput.setInputFiles(resumeAbsPath);
          filled.push(f.id);
          console.log(`[indeed]     -> uploaded resume`);
        } catch (e: any) {
          skipped.push({ id: f.id, reason: `setInputFiles failed: ${e?.message ?? e}` });
        }
        continue;
      }

      let planned = valuesById.get(f.id) ?? valuesByLabel.get(f.label.toLowerCase());
      if (!planned) {
        for (const v of values) {
          const a = v.label.toLowerCase();
          const b = f.label.toLowerCase();
          if (a === b || a.includes(b) || b.includes(a)) {
            planned = v;
            break;
          }
        }
      }
      if (!planned) {
        try {
          console.log(`[indeed]     -> asking Claude: "${f.label}"`);
          const ans = await answerFormField({ field: f, profile, context });
          console.log(`[indeed]     -> Claude: ${JSON.stringify(ans.value)} (conf=${ans.confidence})`);
          if (ans.value !== null && ans.value !== undefined && ans.value !== "") {
            planned = {
              id: f.id,
              label: f.label,
              type: f.type,
              value: ans.value,
              source: "llm",
              confidence: ans.confidence,
              required: f.required,
            };
          }
        } catch (e: any) {
          console.log(`[indeed]     -> Claude error: ${e?.message ?? e}`);
        }
      }
      if (!planned && f.required) {
        const fb = fallbackValueFor(f);
        if (fb !== null && fb !== undefined && fb !== "") {
          planned = {
            id: f.id,
            label: f.label,
            type: f.type,
            value: fb,
            source: "default",
            confidence: 0.4,
            required: f.required,
          };
        }
      }
      if (!planned) {
        if (f.required) skipped.push({ id: f.id, reason: `no value for "${f.label}"` });
        continue;
      }
      if (planned.value === null || planned.value === undefined || planned.value === "") {
        if (f.required) {
          const fb = fallbackValueFor(f);
          if (fb !== null && fb !== undefined && fb !== "") {
            planned = { ...planned, value: fb, source: "default" };
          } else {
            skipped.push({ id: f.id, reason: `empty value for "${f.label}"` });
            continue;
          }
        } else {
          continue;
        }
      }
      const ok = await fillFieldById(page, f.id, planned.value);
      if (ok) filled.push(f.id);
      else skipped.push({ id: f.id, reason: `fill failed for "${f.label}"` });
      await page.waitForTimeout(150);
    }

    // Click Continue / Next. If the next button isn't present, we're on the
    // review step — stop before Submit.
    const continueBtn = page
      .locator(
        [
          "button:has-text('Continue')",
          "button:has-text('Next')",
          "button:has-text('Save and continue')",
          "button[data-testid='IndeedApplyButton-continue']",
          "button[type='submit']:not(:has-text('Submit'))",
        ].join(", ")
      )
      .first();

    const submitBtn = page
      .locator("button:has-text('Submit your application'), button:has-text('Submit application')")
      .first();
    if (await submitBtn.isVisible().catch(() => false)) {
      console.log("[indeed] reached Submit step — stopping before submit");
      await submitBtn.scrollIntoViewIfNeeded().catch(() => undefined);
      break;
    }

    if (!(await continueBtn.isVisible().catch(() => false))) {
      console.log("[indeed] no Continue button — assuming done");
      break;
    }
    await continueBtn.click().catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
    await page.waitForTimeout(900);
  }

  console.log("[indeed] fill done — user clicks Submit.");
  return { filled, skipped, reviewUrl: page.url() };
}

/* ---------- helpers ---------- */

function extractJk(url: string): string {
  return url.match(/[?&]jk=([^&]+)/)?.[1] || "";
}

async function waitForCloudflare(page: Page) {
  const body = (await page.locator("body").innerText().catch(() => "")) || "";
  if (
    /verify you are human|verifying you are human|just a moment|please complete the security check/i.test(
      body
    )
  ) {
    console.warn(
      "[indeed] Cloudflare challenge — solve it in the visible window; waiting up to 120s..."
    );
    await page
      .waitForSelector(
        "button[id^='indeedApplyButton'], [data-testid='IndeedApplyButton'], button:has-text('Apply')",
        { timeout: 120_000 }
      )
      .catch(() => undefined);
  }
}

/**
 * After clicking "Apply now", Indeed sometimes opens a new tab on
 * smartapply.indeed.com or m5.apply.indeed.com. Return whichever page is on
 * an apply host (prefer the newest one).
 */
async function activeIndeedPage(ctx: any, fallback: Page): Promise<Page> {
  const pages: Page[] = ctx.pages();
  for (let i = pages.length - 1; i >= 0; i--) {
    const u = pages[i].url();
    if (/smartapply\.indeed|apply\.indeed/.test(u)) return pages[i];
  }
  return fallback;
}

async function syncWithSmartApplyTab(ctx: any, page: Page) {
  // Brief wait + scan; SmartApply usually opens in same tab now but historically
  // used a popup.
  for (let i = 0; i < 6; i++) {
    const pages: Page[] = ctx.pages();
    const sa = pages.find((p) => /smartapply\.indeed|apply\.indeed/.test(p.url()));
    if (sa) {
      await sa.bringToFront().catch(() => undefined);
      return;
    }
    await page.waitForTimeout(500);
  }
}

async function extractFieldsFromPage(page: Page): Promise<FormField[]> {
  const script = `(function(){
    function textOf(el){return ((el && el.textContent) ? el.textContent : "").replace(/\\s+/g, " ").trim();}
    function currentValueOf(el){
      var tag=el.tagName;
      if(tag==="SELECT"){
        var sel=el.options[el.selectedIndex];
        if(!sel)return "";
        var t=(sel.text||"").toLowerCase().trim();
        if(!sel.value||t===""||t.indexOf("select")===0||t.indexOf("choose")===0)return "";
        return sel.value;
      }
      if(tag==="INPUT"){
        var t2=(el.type||"").toLowerCase();
        if(t2==="checkbox"||t2==="radio")return el.checked?el.value:"";
        if(t2==="file")return el.files&&el.files.length>0?el.files[0].name:"";
        return el.value||"";
      }
      if(tag==="TEXTAREA")return el.value||"";
      return "";
    }
    function inferType(el){
      var tag=el.tagName;
      if(tag==="TEXTAREA")return "textarea";
      if(tag==="SELECT")return "select";
      if(tag==="INPUT"){
        var t=(el.type||"").toLowerCase();
        if(t==="email")return "email";
        if(t==="tel"||t==="phone")return "phone";
        if(t==="number")return "number";
        if(t==="url")return "url";
        if(t==="checkbox")return "checkbox";
        if(t==="radio")return "yes_no";
        if(t==="file")return "file";
        return "text";
      }
      return "unknown";
    }
    var out=[];
    var seen={};
    // Indeed SmartApply doesn't always wrap in a <form>, so scan the whole doc.
    var nodes=document.querySelectorAll("input:not([type='hidden']):not([disabled]), select, textarea");
    for(var i=0;i<nodes.length;i++){
      var el=nodes[i];
      // Skip elements that aren't visible.
      var rect=el.getBoundingClientRect();
      if(rect.width===0 && rect.height===0) continue;
      var id=el.id||el.name||("indeed-"+i);
      if(seen[id])continue;
      seen[id]=true;

      var label="";
      if(el.id){
        var lbl=document.querySelector("label[for='"+el.id.replace(/'/g,"\\\\'")+"']");
        if(lbl)label=textOf(lbl);
      }
      if(!label){
        var wrap=el.closest("[data-testid^='input'], fieldset, label, div.ia-Questions-item, div[class*='Question']");
        if(wrap){
          var lblEl=wrap.querySelector("label, legend, [data-testid*='label']");
          if(lblEl)label=textOf(lblEl);
        }
      }
      if(!label)label=el.getAttribute("aria-label")||el.getAttribute("placeholder")||"";
      if(!label)continue;
      label=label.replace(/\\s*\\*\\s*$/,"").replace(/\\s+required\\s*$/i,"").replace(/\\s*\\(required\\)\\s*$/i,"").trim();

      var type=inferType(el);
      var options;
      if(el.tagName==="SELECT"){
        options=[];
        for(var k=0;k<el.options.length;k++){
          options.push({value:el.options[k].value,label:el.options[k].text});
        }
      }
      var required=el.hasAttribute("required")||el.getAttribute("aria-required")==="true";

      out.push({id:id,label:label,type:type,required:required,options:options,currentValue:currentValueOf(el)});
    }
    return out;
  })();`;
  try {
    return ((await page.evaluate(script)) as FormField[]) ?? [];
  } catch (e: any) {
    console.log(`[indeed] extract threw: ${e?.message ?? e}`);
    return [];
  }
}

async function fillFieldById(page: Page, id: string, value: any): Promise<boolean> {
  const argJson = JSON.stringify({ id, value });
  const script = `(function(arg){
    var id=arg.id;var value=arg.value;
    var el=document.getElementById(id);
    if(!el){
      var named=document.querySelector("[name="+JSON.stringify(id)+"]");
      if(named)el=named;
    }
    if(!el)return {ok:false,reason:"element not found"};
    function setNative(node,val){
      var proto=node.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
      var desc=Object.getOwnPropertyDescriptor(proto,"value");
      if(desc&&desc.set){desc.set.call(node,val);}else{node.value=val;}
      node.dispatchEvent(new Event("input",{bubbles:true}));
      node.dispatchEvent(new Event("change",{bubbles:true}));
      node.dispatchEvent(new Event("blur",{bubbles:true}));
    }
    if(el.tagName==="SELECT"){
      var vStr=String(value).toLowerCase().trim();
      var match=null;
      for(var p=0;p<2;p++){
        for(var i=0;i<el.options.length;i++){
          var o=el.options[i];
          var oVal=String(o.value||"").toLowerCase().trim();
          var oTxt=String(o.text||"").toLowerCase().trim();
          if(oVal===""||oTxt===""||oTxt.indexOf("select")===0||oTxt.indexOf("choose")===0)continue;
          var hit=p===0?(oVal===vStr||oTxt===vStr):(oVal.indexOf(vStr)>=0||oTxt.indexOf(vStr)>=0);
          if(hit){match=o.value;break;}
        }
        if(match!==null)break;
      }
      if(match===null)return {ok:false,reason:"no option matched"};
      var sp=HTMLSelectElement.prototype;
      var sd=Object.getOwnPropertyDescriptor(sp,"value");
      if(sd&&sd.set){sd.set.call(el,match);}else{el.value=match;}
      el.dispatchEvent(new Event("input",{bubbles:true}));
      el.dispatchEvent(new Event("change",{bubbles:true}));
      el.dispatchEvent(new Event("blur",{bubbles:true}));
      return {ok:true,strategy:"select",reason:match};
    }
    if(el.tagName==="INPUT"){
      var type=(el.type||"").toLowerCase();
      if(type==="checkbox"||type==="radio"){
        if(!el.checked)el.click();
        return {ok:true,strategy:type};
      }
    }
    setNative(el,String(value));
    return {ok:true,strategy:"text"};
  })(${argJson});`;
  try {
    const res = (await page.evaluate(script)) as any;
    return !!res?.ok;
  } catch (e: any) {
    console.log(`[indeed]       fill threw: ${e?.message ?? e}`);
    return false;
  }
}

function cssEscape(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}
