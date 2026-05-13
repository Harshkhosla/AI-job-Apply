import { chromium, type BrowserContext, type Page } from "playwright";
import path from "node:path";
import fs from "node:fs";
import type { FormField, ParsedForm, PlannedField } from "../types.js";
import type { ProfileData } from "../../types.js";
import { answerFormField } from "../../llm/claude.js";

/**
 * If Claude can't answer a question (returns null/empty), use a heuristic
 * fallback so the form still passes validation. Most common case is
 * "How many years of experience in <tech>?" — default to 2 when the
 * candidate hasn't worked with that stack. For yes/no and select we pick
 * a safe default.
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
    const hit = field.options.find((o) =>
      o.label.toLowerCase().includes(target) || o.value.toLowerCase().includes(target)
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

// Shared persistent profile dir — keep separate from LinkedIn so
// company sessions / cookies don't collide.
const PROFILE_DIR = path.resolve(process.cwd(), "data", "playwright", "greenhouse-profile");

let _ctx: BrowserContext | null = null;

async function getContext(): Promise<BrowserContext> {
  if (_ctx) return _ctx;
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  const headless = process.env.GREENHOUSE_HEADLESS === "1";
  _ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless,
    slowMo: 50,
    viewport: { width: 1280, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36",
  });
  return _ctx;
}

export async function closeBrowser(): Promise<void> {
  if (_ctx) await _ctx.close().catch(() => undefined);
  _ctx = null;
}

interface SessionRecord {
  page: Page;
  jobUrl: string;
}
const _sessions = new Map<string, SessionRecord>();

/**
 * Opens the Greenhouse apply page (the public job page already embeds the
 * application form). Extracts the visible form fields into our normalized
 * shape so the existing field-mapper can plan answers.
 */
export async function openGreenhouseJob(jobUrl: string, applicationId: string): Promise<ParsedForm> {
  const ctx = await getContext();
  const pages = ctx.pages();
  const page = pages.length > 0 ? pages[pages.length - 1] : await ctx.newPage();
  await page.bringToFront().catch(() => undefined);

  _sessions.set(applicationId, { page, jobUrl });

  // If we're already on this page, don't reload.
  if (page.url() !== jobUrl) {
    await page.goto(jobUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  }
  await page.waitForTimeout(1500);

  // Greenhouse sometimes routes to a /jobs/<id> view that needs a click on
  // "Apply for this Job" to expand the form, or it's already inline.
  const applyBtn = page
    .locator("a:has-text('Apply for this'), button:has-text('Apply for this'), a:has-text('Apply Now'), button:has-text('Apply Now')")
    .first();
  if (await applyBtn.isVisible().catch(() => false)) {
    console.log("[greenhouse] expanding apply form via button click");
    await applyBtn.click().catch(() => undefined);
    await page.waitForTimeout(1200);
  }

  // Wait for the form. Greenhouse standard form is <form id="application_form">
  // or any form containing the resume upload field.
  try {
    await page
      .locator("form#application_form, form:has(input[name='resume']), form:has(input[type='file'])")
      .first()
      .waitFor({ timeout: 15_000 });
  } catch {
    console.log("[greenhouse] application form not found within 15s");
  }

  const fields = await extractFieldsFromForm(page);
  console.log(`[greenhouse] plan: extracted ${fields.length} fields`);
  for (const f of fields) {
    console.log(
      `[greenhouse]   - id="${f.id}" label="${f.label}" type=${f.type} req=${f.required} current="${f.currentValue ?? ""}"`
    );
  }

  return {
    source: "greenhouse",
    jobBoardToken: "greenhouse",
    jobId: jobUrl,
    applyUrl: jobUrl,
    fields,
  };
}

/**
 * Fill empty fields with planned values, ask Claude for unknowns, attach the
 * uploaded resume to any file input. Stop before clicking Submit — the user
 * reviews and clicks themselves.
 */
export async function fillGreenhouseForm(
  applicationId: string,
  values: PlannedField[],
  profile: ProfileData,
  context: { jobTitle: string; jobCompany: string; jobDescription: string },
  resumeAbsPath?: string
): Promise<{ filled: string[]; skipped: { id: string; reason: string }[]; reviewUrl: string }> {
  const sess = _sessions.get(applicationId);
  if (!sess) throw new Error("No active Greenhouse session — plan first.");
  const page = sess.page;

  const filled: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  const valuesByLabel = new Map<string, PlannedField>();
  const valuesById = new Map<string, PlannedField>();
  for (const v of values) {
    valuesByLabel.set(v.label.toLowerCase(), v);
    valuesById.set(v.id, v);
  }

  console.log("[greenhouse] ==== fill begin ====");

  const stepFields = await extractFieldsFromForm(page);
  for (const f of stepFields) {
    const cur = f.currentValue ? String(f.currentValue).trim() : "";
    console.log(
      `[greenhouse]   field id="${f.id}" label="${f.label}" type=${f.type} req=${f.required} current="${cur}"`
    );

    if (cur !== "") {
      console.log(`[greenhouse]     -> SKIP (already filled)`);
      continue;
    }

    // Resume / file fields
    if (f.type === "file") {
      if (!resumeAbsPath) {
        skipped.push({ id: f.id, reason: "No resume PDF uploaded in profile" });
        console.log(`[greenhouse]     -> SKIP (no resume PDF)`);
        continue;
      }
      try {
        const fileInput = page.locator(`#${cssEscape(f.id)}`).first();
        await fileInput.setInputFiles(resumeAbsPath);
        filled.push(f.id);
        console.log(`[greenhouse]     -> uploaded resume`);
      } catch (e: any) {
        skipped.push({ id: f.id, reason: `setInputFiles failed: ${e?.message ?? e}` });
        console.log(`[greenhouse]     -> file upload failed: ${e?.message ?? e}`);
      }
      continue;
    }

    let planned = valuesById.get(f.id) ?? valuesByLabel.get(f.label.toLowerCase());
    if (!planned) {
      // Fuzzy label match
      for (const v of values) {
        const a = v.label.toLowerCase();
        const b = f.label.toLowerCase();
        if (a === b || a.includes(b) || b.includes(a)) {
          planned = v;
          break;
        }
      }
    }
    // Ask Claude for unknowns
    if (!planned) {
      try {
        console.log(`[greenhouse]     -> asking Claude: "${f.label}"`);
        const ans = await answerFormField({ field: f, profile, context });
        console.log(`[greenhouse]     -> Claude: ${JSON.stringify(ans.value)} (conf=${ans.confidence})`);
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
        console.log(`[greenhouse]     -> Claude error: ${e?.message ?? e}`);
      }
    }
    if (!planned && f.required) {
      // Last-resort fallback for required fields the candidate doesn't have
      // experience with (e.g. "years of Ruby on Rails" → 2).
      const fb = fallbackValueFor(f);
      if (fb !== null && fb !== undefined && fb !== "") {
        console.log(`[greenhouse]     -> using fallback value ${JSON.stringify(fb)}`);
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
          console.log(`[greenhouse]     -> empty planned value; using fallback ${JSON.stringify(fb)}`);
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
    console.log(`[greenhouse]     -> fill returned ${ok}`);
    if (ok) filled.push(f.id);
    else skipped.push({ id: f.id, reason: `fill failed for "${f.label}"` });
    await page.waitForTimeout(150);
  }

  // Scroll to the submit button so the user sees it ready.
  await page
    .locator("input[type='submit'], button[type='submit'], button:has-text('Submit')")
    .first()
    .scrollIntoViewIfNeeded()
    .catch(() => undefined);

  console.log("[greenhouse] fill done — user clicks Submit.");
  return { filled, skipped, reviewUrl: page.url() };
}

/* ---------- field extraction ---------- */

async function extractFieldsFromForm(page: Page): Promise<FormField[]> {
  const script = `(function(){
    var form = document.querySelector("form#application_form")
      || document.querySelector("form[action*='greenhouse']")
      || document.querySelector("form:has(input[name='resume'])")
      || document.querySelector("form:has(input[type='file'])");
    if (!form) return [];
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
    var nodes=form.querySelectorAll("input:not([type='hidden']), select, textarea");
    for(var i=0;i<nodes.length;i++){
      var el=nodes[i];
      var id=el.id||el.name||("gh-"+i);
      if(seen[id])continue;
      seen[id]=true;

      var label="";
      if(el.id){
        var lbl=form.querySelector("label[for='"+el.id+"']");
        if(lbl){
          var first=lbl.firstChild;
          while(first&&first.nodeType!==3&&first.nodeType!==1)first=first.nextSibling;
          if(first){
            if(first.nodeType===3)label=(first.nodeValue||"").trim();
            else label=textOf(first);
          }
          if(!label)label=textOf(lbl);
        }
      }
      if(!label){
        var wrap=el.closest("div.field, div.application-question, div.form-group, label");
        if(wrap){
          var lblEl=wrap.querySelector("label, legend");
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
      var required=el.hasAttribute("required")||!!el.closest("[aria-required='true']");

      out.push({id:id,label:label,type:type,required:required,options:options,currentValue:currentValueOf(el)});
    }
    return out;
  })();`;
  try {
    return ((await page.evaluate(script)) as FormField[]) ?? [];
  } catch (e: any) {
    console.log(`[greenhouse] extract threw: ${e?.message ?? e}`);
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
    console.log(`[greenhouse]       fill: strategy=${res?.strategy} ok=${res?.ok} reason=${res?.reason ?? ""}`);
    return !!res?.ok;
  } catch (e: any) {
    console.log(`[greenhouse]       fill threw: ${e?.message ?? e}`);
    return false;
  }
}

function cssEscape(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}
