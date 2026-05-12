import { chromium, type BrowserContext, type Page } from "playwright";
import path from "node:path";
import fs from "node:fs";
import type { FormField, ParsedForm, PlannedField } from "../types.js";
import type { ProfileData } from "../../types.js";
import { answerFormField } from "../../llm/claude.js";

// Cache Claude answers across applications keyed by `${company}::${question}`
// so we don't burn LLM tokens re-asking the same question on every job.
const _qaCache = new Map<string, any>();
function qaKey(company: string, q: string) {
  return `${company.toLowerCase()}::${q.toLowerCase()}`;
}

// Persistent Chromium profile lives here. First launch is empty → you log in
// to LinkedIn once in the opened window. From then on the profile keeps your
// session forever — no cookie copying.
const PROFILE_DIR = path.resolve(process.cwd(), "data", "playwright", "chrome-profile");

let _context: BrowserContext | null = null;

/**
 * Lazily-launch a persistent Chromium context. Same browser, same profile,
 * across every call until the process exits or `closeBrowser` is called.
 */
async function getContext(): Promise<BrowserContext> {
  if (_context) return _context;
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const headless = process.env.LINKEDIN_HEADLESS === "1";
  _context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless,
    slowMo: 50,
    viewport: { width: 1280, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36",
  });

  // Detect if signed in by visiting /feed; if not, surface a clear error so
  // the user knows to log in manually in the opened window.
  // We do this lazily on first job navigation instead so the user can sign in
  // in the same browser tab.
  return _context;
}

export async function closeBrowser(): Promise<void> {
  if (_context) await _context.close().catch(() => undefined);
  _context = null;
}

/**
 * Open the LinkedIn job posting, click "Easy Apply", and walk through
 * each modal page extracting fields without submitting anything.
 *
 * Returns a ParsedForm describing every visible field across all steps,
 * plus a Page handle so the caller can later fill values without
 * re-walking from scratch (held via internal cache).
 */

interface SessionRecord {
  page: Page;
  jobUrl: string;
}
const _sessions = new Map<string, SessionRecord>();

export async function openLinkedInJob(jobUrl: string, applicationId: string): Promise<ParsedForm> {
  const ctx = await getContext();

  // Reuse the *most recent* tab in the persistent browser so we don't spawn a
  // new window every plan. (pages[0] can be a stale background tab.)
  const pages = ctx.pages();
  const page = pages.length > 0 ? pages[pages.length - 1] : await ctx.newPage();
  await page.bringToFront().catch(() => undefined);

  // Normalize regional subdomains (in.linkedin.com, uk.linkedin.com, etc.) to
  // www.linkedin.com — regional hosts force a re-auth dance that can loop.
  // Also rewrite the path to the canonical /jobs/view/<id>/ form when possible.
  const normalizedUrl = normalizeJobUrl(jobUrl);
  _sessions.set(applicationId, { page, jobUrl: normalizedUrl });

  // If we're already sitting on the same job page, don't reload — it loses
  // any modal state and re-triggers React hydration unnecessarily.
  if (!page.url().includes(jobIdOf(normalizedUrl) ?? "----")) {
    await page.goto(normalizedUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  }
  await page.waitForTimeout(1500);

  // Auth wall detection — if not signed in, give the user up to 3 minutes to
  // log in manually in this same browser tab, then continue automatically.
  if (/\/(login|checkpoint|authwall|uas\/login)/i.test(page.url())) {
    console.log("[linkedin] Not signed in. Waiting up to 3 min for you to log in in the opened window...");
    try {
      await page.waitForURL((u) => !/\/(login|checkpoint|authwall|uas\/login)/i.test(u.toString()), {
        timeout: 180_000,
      });
    } catch {
      throw new Error(
        "Timed out waiting for LinkedIn login. Log in inside the opened Chromium window, then click 'Plan application' again."
      );
    }
    // After login LinkedIn often redirects to /feed; navigate back to the job.
    await page.goto(normalizedUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(1500);
  }

  // LinkedIn never reaches network-idle (long-polling). Just wait for DOM +
  // a fixed pause for React hydration.
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await page.waitForTimeout(2500);

  // LinkedIn's Easy Apply trigger can be an <a> link OR a <button>, with the
  // label wrapped in a <span>/<p>. Match the text and walk up to whichever
  // ancestor is the actual interactive element.
  let clicked = false;
  try {
    const easyText = page.locator(":text-matches('Easy Apply', 'i')").first();
    await easyText.waitFor({ state: "attached", timeout: 20_000 });
    const handle = await easyText.elementHandle();
    if (handle) {
      const btn = await handle.evaluateHandle((el) => {
        const e = el as Element;
        return (
          e.closest("button, a[href], [role='button']") ||
          e.closest("a") ||
          e
        );
      });
      const btnEl = btn.asElement();
      if (btnEl) {
        await btnEl.evaluate((b) =>
          (b as HTMLElement).scrollIntoView({ block: "center" })
        );
        await page.waitForTimeout(300);
        await btnEl.click({ timeout: 10_000 });
        clicked = true;
      }
    }
  } catch {
    // fall through to diagnostics
  }

  if (!clicked) {
    // Wider sweep — use string-body scripts to avoid tsx/esbuild __name issue.
    const buttons = (await page
      .evaluate(
        `(function(){var out=[];var els=document.querySelectorAll('button');for(var i=0;i<Math.min(80,els.length);i++){var e=els[i];out.push({tag:'button',text:(e.innerText||'').trim().slice(0,80),aria:(e.getAttribute('aria-label')||'').slice(0,80)})}return out;})();` as any
      )
      .catch(() => [])) as { tag: string; text: string; aria: string }[];
    const links = (await page
      .evaluate(
        `(function(){var out=[];var els=document.querySelectorAll('a');for(var i=0;i<Math.min(40,els.length);i++){var e=els[i];out.push({tag:'a',text:(e.innerText||'').trim().slice(0,80),aria:(e.getAttribute('aria-label')||'').slice(0,80)})}return out;})();` as any
      )
      .catch(() => [])) as { tag: string; text: string; aria: string }[];
    console.log("[linkedin] no Easy Apply button. Buttons:", buttons);
    console.log("[linkedin] links:", links);

    const txt = (b: { text: string; aria: string }) => `${b.text} ${b.aria}`.toLowerCase();
    const hasInterested = buttons.some((b) => /i.?m interested|i am interested/.test(txt(b)));
    const hasExternal = buttons.some((b) => /^apply$/.test(b.text.trim().toLowerCase()));
    const dbg = path.join(PROFILE_DIR, "..", `easy-apply-miss-${Date.now()}.png`);
    await page.screenshot({ path: dbg, fullPage: false }).catch(() => undefined);

    if (hasInterested) {
      throw new Error(
        `This job doesn't offer Easy Apply for your LinkedIn account — only "I'm interested" is available. ` +
          `LinkedIn shows different apply experiences based on region, account type, and A/B test bucket. ` +
          `Click "Open posting" and apply on the company site, or try a different job. (Screenshot: ${dbg})`
      );
    }
    if (hasExternal) {
      throw new Error(
        "This LinkedIn posting routes to an external company site (not Easy Apply). Click 'Open posting' and apply manually."
      );
    }
    throw new Error(
      `No apply button found on this LinkedIn page. The job may have expired, you may be signed in with a different account, ` +
        `or the page is still loading. Screenshot: ${dbg}.`
    );
  }
  // The Easy Apply modal can take a moment to open.
  await page
    .locator("div.artdeco-modal, div[role='dialog']")
    .first()
    .waitFor({ timeout: 15000 });
  await page.waitForTimeout(1000);

  // Only extract fields from the *current* step. We leave the modal open on
  // step 1 so the fill phase can populate values BEFORE clicking Next.
  const fields = await extractFieldsFromModal(page);
  console.log(`[linkedin] plan: extracted ${fields.length} fields on step 1`);
  for (const f of fields) {
    console.log(
      `[linkedin]   - id="${f.id}" label="${f.label}" type=${f.type} req=${f.required} current="${f.currentValue ?? ""}"`
    );
  }

  return {
    source: "linkedin" as any,
    jobBoardToken: "linkedin",
    jobId: jobUrl,
    applyUrl: jobUrl,
    fields,
  };
}

/**
 * Walk through the Easy Apply modal step-by-step. On each step we:
 *   1. Re-extract the fields visible RIGHT NOW (later steps reveal new ones)
 *   2. Match each against the planned values (by id, then by fuzzy label)
 *   3. Fill what we can
 *   4. Click "Next"/"Continue" if there is one; otherwise stop
 * The bot stops on the review/submit step. The user clicks "Submit" themselves.
 */
export async function fillLinkedInForm(
  applicationId: string,
  values: PlannedField[],
  profile?: ProfileData,
  context?: { jobTitle: string; jobCompany: string; jobDescription: string }
): Promise<{ filled: string[]; skipped: { id: string; reason: string }[]; reviewUrl: string }> {
  const sess = _sessions.get(applicationId);
  if (!sess) throw new Error("No active LinkedIn session — call openLinkedInJob first.");
  const page = sess.page;

  // If the modal isn't open anymore (user closed it after planning, or
  // navigated away), re-open by re-clicking Easy Apply on the current page.
  let modalCount = await page
    .locator("div.artdeco-modal, div[role='dialog']")
    .count();
  if (modalCount === 0) {
    console.log("[linkedin] modal not open — re-clicking Easy Apply...");
    // If the page isn't on the job, navigate back.
    if (!page.url().includes(jobIdOf(sess.jobUrl) ?? "----")) {
      await page.goto(sess.jobUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(1500);
    }
    try {
      const easyText = page.locator(":text-matches('Easy Apply', 'i')").first();
      await easyText.waitFor({ state: "attached", timeout: 15_000 });
      const handle = await easyText.elementHandle();
      if (handle) {
        const btn = await handle.evaluateHandle((el) => {
          const e = el as Element;
          return e.closest("button, a[href], [role='button']") || e.closest("a") || e;
        });
        const btnEl = btn.asElement();
        if (btnEl) {
          await btnEl.evaluate((b) => (b as HTMLElement).scrollIntoView({ block: "center" }));
          await page.waitForTimeout(300);
          await btnEl.click({ timeout: 10_000 });
        }
      }
      await page
        .locator("div.artdeco-modal, div[role='dialog']")
        .first()
        .waitFor({ timeout: 15000 });
      await page.waitForTimeout(1000);
      modalCount = 1;
    } catch (e: any) {
      throw new Error(
        "Easy Apply modal isn't open and the bot couldn't reopen it. Click 'Plan application' again. " +
          `(detail: ${e?.message ?? e})`
      );
    }
  }

  const filled: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  const valuesByLabel = new Map<string, PlannedField>();
  const valuesById = new Map<string, PlannedField>();
  for (const v of values) {
    valuesByLabel.set(v.label.toLowerCase(), v);
    valuesById.set(v.id, v);
  }

  console.log("");
  console.log("[linkedin] ==== fill begin ====");
  console.log(`[linkedin] planned values (${values.length}):`);
  for (const v of values) {
    console.log(
      `[linkedin]   - id=${v.id} | label="${v.label}" | value=${JSON.stringify(v.value)} | source=${v.source} | conf=${v.confidence}`
    );
  }

  const MAX_STEPS = 8;
  for (let step = 0; step < MAX_STEPS; step++) {
    const stepFields = await extractFieldsFromModal(page);
    console.log("");
    console.log(`[linkedin] -- step ${step + 1}: extracted ${stepFields.length} fields --`);

    // Detect a Resume-picker step. LinkedIn always pre-selects a default
    // resume here, so we should NOT touch it — just verify a radio is
    // already checked, then click Next.
    const ctxFrame: any = (page as any)._modalFrame ?? page;
    const isResumeStep = await ctxFrame
      .evaluate(
        `(function(){
          var root = document.querySelector("div.jobs-easy-apply-content")
            || document.querySelector("div.jobs-easy-apply-modal")
            || document.querySelector("div[data-test-modal]")
            || document.querySelector("div.artdeco-modal")
            || document.querySelector("div[role='dialog']")
            || document.querySelector("dialog");
          if (!root) return { is: false, reason: "no root" };
          var bodyText = (root.innerText || '').toLowerCase();

          // Strong signals — any of these = resume step.
          var headings = root.querySelectorAll('h1, h2, h3, h4');
          for (var i = 0; i < headings.length; i++) {
            var ht = (headings[i].innerText || '').toLowerCase();
            if (ht === 'resume' || ht.indexOf('resume') === 0) return { is: true, reason: "heading: " + ht };
          }
          if (bodyText.indexOf('upload resume') >= 0) return { is: true, reason: "upload resume button" };
          if (bodyText.indexOf('be sure to include an updated resume') >= 0) return { is: true, reason: "resume copy" };
          if (/\\.pdf\\b/.test(bodyText)) return { is: true, reason: "PDF chip visible" };
          if (/\\.docx?\\b/.test(bodyText)) return { is: true, reason: "DOC chip visible" };

          return { is: false, reason: "no signals" };
        })();` as any
      )
      .catch(() => ({ is: false, reason: "evaluate threw" })) as any;

    console.log(`[linkedin] resume-step check: ${JSON.stringify(isResumeStep)}`);
    if (isResumeStep && isResumeStep.is) {
      console.log("[linkedin] resume step — keeping LinkedIn's default selection, going straight to Next");
      stepFields.length = 0;
    }

    for (const f of stepFields) {
      const cur = f.currentValue ? String(f.currentValue).trim() : "";
      console.log(
        `[linkedin]   field id="${f.id}" label="${f.label}" type=${f.type} required=${f.required} current="${cur}"`
      );

      // Skip fields LinkedIn already pre-filled.
      if (cur !== "") {
        console.log(`[linkedin]     -> SKIP (already has value)`);
        continue;
      }

      // Skip individual radio options that come as separate fields — we'll
      // fill them via the parent (radio_group) below.
      if (f.label === "Yes" || f.label === "No") {
        console.log(`[linkedin]     -> SKIP (radio child of a group)`);
        continue;
      }

      let planned = valuesById.get(f.id) ?? valuesByLabel.get(f.label.toLowerCase());
      let matchMethod: string = planned ? (valuesById.has(f.id) ? "id" : "exact-label") : "";
      if (!planned) {
        for (const v of values) {
          const a = v.label.toLowerCase();
          const b = f.label.toLowerCase();
          if (a === b || a.includes(b) || b.includes(a)) {
            planned = v;
            matchMethod = "fuzzy-label";
            break;
          }
        }
      }
      // If no plan match but we have profile + Claude, generate an answer on the fly.
      if (!planned && profile && context) {
        const cached = _qaCache.get(qaKey(context.jobCompany, f.label));
        if (cached !== undefined) {
          planned = { id: f.id, label: f.label, type: f.type, value: cached, source: "llm", confidence: 0.7, required: f.required };
          matchMethod = "llm-cache";
        } else {
          try {
            console.log(`[linkedin]     -> asking Claude: "${f.label}"`);
            const ans = await answerFormField({ field: f, profile, context });
            console.log(`[linkedin]     -> Claude answered: ${JSON.stringify(ans.value)} (conf=${ans.confidence})`);
            if (ans.value !== null && ans.value !== "" && ans.value !== undefined) {
              _qaCache.set(qaKey(context.jobCompany, f.label), ans.value);
              planned = {
                id: f.id,
                label: f.label,
                type: f.type,
                value: ans.value,
                source: "llm",
                confidence: ans.confidence,
                required: f.required,
              };
              matchMethod = "llm";
            }
          } catch (e: any) {
            console.log(`[linkedin]     -> Claude error: ${e?.message ?? e}`);
          }
        }
      }
      if (!planned) {
        console.log(`[linkedin]     -> NO match in plan`);
        if (f.required) skipped.push({ id: f.id, reason: `no planned value for "${f.label}"` });
        continue;
      }
      console.log(
        `[linkedin]     -> matched via ${matchMethod} → value=${JSON.stringify(planned.value)}`
      );
      if (planned.value === null || planned.value === undefined || planned.value === "") {
        console.log(`[linkedin]     -> value empty in plan, skipping`);
        if (f.required) skipped.push({ id: f.id, reason: `value missing for "${f.label}"` });
        continue;
      }
      const ok = await fillFieldByLabel(page, f.id, f.label, planned.value);
      console.log(`[linkedin]     -> fill returned ${ok}`);
      if (ok) filled.push(f.id);
      else skipped.push({ id: f.id, reason: `could not locate input for "${f.label}"` });
      await page.waitForTimeout(200);
    }

    // The action buttons live in the same iframe (or document) as the form.
    const frame: any = (page as any)._modalFrame ?? page;

    // Dump only buttons INSIDE the modal root (not the entire job page nav).
    const buttons = (await frame
      .evaluate(
        `(function(){
          var root = document.querySelector("div.jobs-easy-apply-content")
            || document.querySelector("div.jobs-easy-apply-modal")
            || document.querySelector("div[data-test-modal]")
            || document.querySelector("div.artdeco-modal")
            || document.querySelector("div[role='dialog']")
            || document.querySelector("dialog");
          if (!root) return [];
          var out=[];
          var bs=root.querySelectorAll('button');
          for(var i=0;i<bs.length;i++){
            var b=bs[i];
            var rect=b.getBoundingClientRect();
            if(rect.width===0 && rect.height===0) continue;
            out.push({
              text:(b.innerText||'').trim().slice(0,80),
              aria:(b.getAttribute('aria-label')||'').slice(0,80),
              disabled:!!b.disabled
            });
          }
          return out;
        })();` as any
      )
      .catch(() => [])) as { text: string; aria: string; disabled: boolean }[];
    console.log("[linkedin] buttons in modal frame:");
    for (const b of buttons) {
      console.log(`[linkedin]   - text="${b.text}" aria="${b.aria}" disabled=${b.disabled}`);
    }

    // Find the button using the dumped list — most resilient.
    function findBtnText(re: RegExp): { text: string; aria: string; disabled: boolean } | null {
      return buttons.find((b) => re.test(b.text) || re.test(b.aria)) ?? null;
    }
    const submitInfo = findBtnText(/submit application/i);
    const reviewInfo = findBtnText(/^review$|review your application/i);
    const nextInfo = findBtnText(/^next$|continue to next step|continue$/i);

    if (submitInfo) {
      console.log("[linkedin] at submit step — stopping (user clicks Submit).");
      break;
    }
    if (reviewInfo) {
      console.log(`[linkedin] clicking Review: "${reviewInfo.text || reviewInfo.aria}"`);
      await clickModalButton(frame, reviewInfo);
      await page.waitForTimeout(1200);
      console.log("[linkedin] at review step — stopping.");
      break;
    }
    if (!nextInfo) {
      console.log("[linkedin] no Next button found — stopping.");
      break;
    }
    if (nextInfo.disabled) {
      console.log("[linkedin] Next is disabled — required field still empty.");
      break;
    }
    console.log(`[linkedin] clicking Next: "${nextInfo.text || nextInfo.aria}"`);

    // Snapshot the current field ids before clicking so we can detect a refusal.
    const beforeIds = stepFields.map((f) => f.id).join("|");
    await clickModalButton(frame, nextInfo);
    await page.waitForTimeout(1500);

    // Did LinkedIn actually advance? If the same fields are still showing
    // there's likely an inline validation error.
    const afterFields = await extractFieldsFromModal(page);
    const afterIds = afterFields.map((f) => f.id).join("|");
    if (afterIds === beforeIds && afterFields.length > 0) {
      console.log("[linkedin] step didn't advance — checking inline errors...");
      const errors = await collectInlineErrors(frame);
      console.log(`[linkedin] inline errors:`, errors);
      if (errors.length > 0 && profile && context) {
        // Try to fix each errored field via Claude with the constraint hint.
        let fixed = 0;
        for (const err of errors) {
          // Find the field this error belongs to.
          const target = afterFields.find(
            (f) =>
              f.id === err.forId ||
              (err.label && f.label.toLowerCase() === err.label.toLowerCase())
          );
          if (!target) {
            console.log(`[linkedin]   unable to map error to field: ${JSON.stringify(err)}`);
            continue;
          }
          try {
            const enrichedField = { ...target, description: `${target.description ?? ""}\nVALIDATION ERROR: ${err.message}. Re-answer with a valid value.`.trim() };
            console.log(`[linkedin]   asking Claude (with error context) for "${target.label}"...`);
            const ans = await answerFormField({ field: enrichedField, profile, context });
            console.log(`[linkedin]   Claude re-answered: ${JSON.stringify(ans.value)} (conf=${ans.confidence})`);
            if (ans.value !== null && ans.value !== "" && ans.value !== undefined) {
              _qaCache.set(qaKey(context.jobCompany, target.label), ans.value);
              const ok = await fillFieldByLabel(page, target.id, target.label, ans.value);
              console.log(`[linkedin]   re-fill returned ${ok}`);
              if (ok) fixed++;
            }
          } catch (e: any) {
            console.log(`[linkedin]   Claude error: ${e?.message ?? e}`);
          }
        }
        if (fixed > 0) {
          console.log(`[linkedin] fixed ${fixed} field(s); clicking Next again`);
          await clickModalButton(frame, nextInfo);
          await page.waitForTimeout(1500);
        } else {
          console.log("[linkedin] couldn't fix errors — stopping for manual review");
          break;
        }
      } else {
        console.log("[linkedin] no inline errors detected — bailing");
        break;
      }
    }
  }

  return { filled, skipped, reviewUrl: page.url() };
}

/* ---------- field extraction ---------- */

// IMPORTANT: this string is shipped verbatim to the browser via
// page.evaluate(). Keep it as a string (not a function literal) so esbuild /
// tsx doesn't inject helpers like `__name` that the browser can't resolve.
// Each returned field includes a `currentValue` so the caller can decide
// whether to fill it (we only fill empties).
const EXTRACT_FIELDS_SCRIPT = `
(function () {
  // Try multiple modal container selectors. LinkedIn uses different ones
  // for Easy Apply vs other modals.
  var root =
    document.querySelector("div.jobs-easy-apply-content") ||
    document.querySelector("div.jobs-easy-apply-modal") ||
    document.querySelector("div[data-test-modal]") ||
    document.querySelector("div.artdeco-modal") ||
    document.querySelector("div[role='dialog']") ||
    document.querySelector("dialog");
  if (!root) return [];
  function textOf(el) { return (el && el.textContent ? el.textContent : "").replace(/\\s+/g, " ").trim(); }
  function currentValueOf(el) {
    var tag = el.tagName;
    if (tag === "SELECT") {
      var sel = el.options[el.selectedIndex];
      return sel ? sel.value : "";
    }
    if (tag === "INPUT") {
      var t = (el.type || "").toLowerCase();
      if (t === "checkbox" || t === "radio") return el.checked ? el.value : "";
      return el.value || "";
    }
    if (tag === "TEXTAREA") return el.value || "";
    if (tag === "FIELDSET") {
      var checked = el.querySelector("input[type='radio']:checked");
      return checked ? checked.value : "";
    }
    return "";
  }
  function inferType(input) {
    var tag = input.tagName;
    if (tag === "TEXTAREA") return "textarea";
    if (tag === "SELECT") return "select";
    if (tag === "INPUT") {
      var t = (input.type || "").toLowerCase();
      if (t === "email") return "email";
      if (t === "tel" || t === "phone") return "phone";
      if (t === "number") return "number";
      if (t === "url") return "url";
      if (t === "checkbox") return "checkbox";
      if (t === "radio") return "yes_no";
      if (t === "file") return "file";
      return "text";
    }
    return "unknown";
  }
  var out = [];
  var seen = {};
  var nodes = root.querySelectorAll("input:not([type='hidden']), select, textarea, fieldset");
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    var id = el.id || el.name || ("lk-" + i);
    if (seen[id]) continue;
    seen[id] = true;

    var label = "";
    if (el.id) {
      var lbl = root.querySelector("label[for='" + el.id + "']");
      if (lbl) {
        // Use only the FIRST text node of the label so we don't pick up
        // hint/visually-hidden duplicate spans.
        var first = lbl.firstChild;
        while (first && first.nodeType !== 3 && first.nodeType !== 1) first = first.nextSibling;
        if (first) {
          if (first.nodeType === 3) label = (first.nodeValue || "").trim();
          else label = textOf(first);
        }
        if (!label) label = textOf(lbl);
      }
    }
    if (!label) {
      var wrap = el.closest("div.fb-dash-form-element, fieldset, label");
      if (wrap) {
        var lblEl = wrap.querySelector("label, legend, .artdeco-text-input--label");
        if (lblEl) label = textOf(lblEl);
      }
    }
    if (!label) label = el.getAttribute("aria-label") || "";
    if (!label) continue;
    // Strip trailing " Required" / "(required)" markers that some LinkedIn
    // labels include twice in their accessible name.
    label = label.replace(/\\s+required\\s*$/i, "").replace(/\\s*\\(required\\)\\s*$/i, "");
    // Collapse doubled labels: "Foo? Foo?" -> "Foo?"
    var dup = label.match(/^(.+?)\\s*\\1$/);
    if (dup) label = dup[1].trim();
    // Final fallback: if string contains the same sentence twice anywhere
    var half = Math.floor(label.length / 2);
    if (label.length > 4 && label.substring(0, half).trim() === label.substring(half).trim()) {
      label = label.substring(0, half).trim();
    }

    var type = "text";
    var options;
    var required = el.hasAttribute("required") || !!el.closest("[aria-required='true']") || !!el.closest(".fb-dash-form-element--required");

    if (el.tagName === "FIELDSET") {
      var radios = el.querySelectorAll("input[type='radio']");
      if (radios.length > 0) {
        type = "yes_no";
        options = [];
        for (var j = 0; j < radios.length; j++) {
          var r = radios[j];
          options.push({ value: r.value, label: textOf(r.closest("label")) || r.value });
        }
      } else {
        continue;
      }
    } else {
      type = inferType(el);
      if (el.tagName === "SELECT") {
        options = [];
        for (var k = 0; k < el.options.length; k++) {
          options.push({ value: el.options[k].value, label: el.options[k].text });
        }
      }
    }

    out.push({ id: id, label: label, type: type, required: required, options: options, currentValue: currentValueOf(el) });
  }
  return out;
})();
`;

/**
 * Pick the frame that contains the Easy Apply modal. LinkedIn embeds it in
 * one of several iframes (talent/sourcing/jobs-applet etc.).
 */
async function pickModalFrame(page: Page) {
  for (const frame of page.frames()) {
    try {
      const has = await frame.evaluate(
        `!!(document.querySelector("div.jobs-easy-apply-content") || document.querySelector("div.jobs-easy-apply-modal") || document.querySelector("div[data-test-modal]") || document.querySelector("div.artdeco-modal") || document.querySelector("div[role='dialog']"))`
      );
      if (has) return frame;
    } catch {
      // some frames (cross-origin) will throw — skip them
    }
  }
  return null;
}

async function extractFieldsFromModal(page: Page): Promise<FormField[]> {
  try {
    const frame = await pickModalFrame(page);
    if (!frame) {
      // No frame has the modal — diagnose what's available
      const allFrames = page.frames().map((f) => ({ name: f.name(), url: f.url().slice(0, 100) }));
      console.log("[linkedin] extract: no frame contains modal. Frames:", allFrames);
      return [];
    }
    console.log(`[linkedin] extract: modal found in frame name="${frame.name()}" url="${frame.url().slice(0, 80)}"`);
    const fields = (await frame.evaluate(EXTRACT_FIELDS_SCRIPT as any)) as FormField[];
    if (!fields || fields.length === 0) {
      const diag = (await frame.evaluate(
        `(function(){
          function probe(sel){var els=document.querySelectorAll(sel);return{count:els.length,first:els[0]?{tag:els[0].tagName,cls:(els[0].className||'').slice(0,160),inputs:els[0].querySelectorAll("input:not([type='hidden'])").length,selects:els[0].querySelectorAll('select').length,textareas:els[0].querySelectorAll('textarea').length}:null}}
          return{
            artdecoModal:probe('div.artdeco-modal'),
            roleDialog:probe("div[role='dialog']"),
            dataTestModal:probe('div[data-test-modal]'),
            dialogTag:probe('dialog'),
            jobsEasyApply:probe('.jobs-easy-apply-content, .jobs-easy-apply-modal'),
            anyVisibleForm:document.querySelectorAll('form').length,
            anyInputs:document.querySelectorAll("input:not([type='hidden'])").length
          };
        })();` as any
      )) as any;
      console.log("[linkedin] extract found modal but 0 fields. Frame probe:", JSON.stringify(diag, null, 2));
    }
    // Stash the frame on the page for fill use
    (page as any)._modalFrame = frame;
    return fields ?? [];
  } catch (e: any) {
    console.log("[linkedin] extract threw:", e?.message ?? e);
    return [];
  }
}

// String-body fill script. Runs entirely in the browser so esbuild/tsx
// can't inject helpers (__name) that fail in page.evaluate. Playwright passes
// a SINGLE argument to the IIFE, so we destructure {id,label,value} from it.
const FILL_FIELD_SCRIPT = `
(function (arg) {
  var id = arg.id;
  var label = arg.label;
  var value = arg.value;
  function findRoot() {
    return (
      document.querySelector("div.jobs-easy-apply-content") ||
      document.querySelector("div.jobs-easy-apply-modal") ||
      document.querySelector("div[data-test-modal]") ||
      document.querySelector("div.artdeco-modal") ||
      document.querySelector("div[role='dialog']") ||
      document.querySelector("dialog") ||
      document.body
    );
  }
  function txt(el) { return ((el && el.textContent) ? el.textContent : "").replace(/\\s+/g, " ").trim(); }
  function setNativeValue(el, val) {
    var proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) { desc.set.call(el, val); } else { el.value = val; }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }
  function fillControl(el, val) {
    if (!el) return false;
    var tag = el.tagName;
    if (tag === "SELECT") {
      var match = null;
      for (var i = 0; i < el.options.length; i++) {
        var o = el.options[i];
        if (String(o.value) === String(val) || String(o.text) === String(val) || o.text.toLowerCase().indexOf(String(val).toLowerCase()) >= 0) {
          match = o.value; break;
        }
      }
      if (match !== null) {
        el.value = match;
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
      return false;
    }
    if (tag === "INPUT") {
      var type = (el.type || "").toLowerCase();
      if (type === "checkbox" || type === "radio") {
        if (!el.checked) { el.click(); }
        return true;
      }
      el.focus();
      setNativeValue(el, String(val));
      return true;
    }
    if (tag === "TEXTAREA") {
      el.focus();
      setNativeValue(el, String(val));
      return true;
    }
    return false;
  }
  var root = findRoot();
  var labelLc = String(label).toLowerCase();

  // 0) Direct id match — extractor already gave us the exact element id.
  if (id) {
    var direct = document.getElementById(id);
    if (direct) {
      // If this is a fieldset / radio group container, pick the radio whose
      // label matches the value.
      var radios = direct.querySelectorAll ? direct.querySelectorAll("input[type='radio']") : null;
      if (radios && radios.length > 0) {
        var want = String(value).toLowerCase();
        for (var ri = 0; ri < radios.length; ri++) {
          var rd = radios[ri];
          var rlbl = ((rd.closest("label") && rd.closest("label").textContent) || rd.value || "").toLowerCase();
          if (rlbl.indexOf(want) >= 0) {
            if (!rd.checked) rd.click();
            return { ok: true, strategy: "id-radio", reason: rlbl };
          }
        }
      }
      if (fillControl(direct, value)) {
        return { ok: true, strategy: "id", reason: id };
      }
      var inner = direct.querySelector("input:not([type='hidden']), select, textarea");
      if (inner && fillControl(inner, value)) {
        return { ok: true, strategy: "id-inner", reason: id };
      }
    }
  }

  // 1) <label for=...>
  var labels = root.querySelectorAll("label");
  for (var i = 0; i < labels.length; i++) {
    if (txt(labels[i]).toLowerCase().indexOf(labelLc) >= 0) {
      var forId = labels[i].getAttribute("for");
      if (forId) {
        var ctl = document.getElementById(forId);
        if (ctl && fillControl(ctl, value)) return { ok: true, strategy: "label-for", reason: forId };
      }
      var wrap = labels[i].closest("div.fb-dash-form-element, .artdeco-text-input--container, label");
      if (wrap) {
        var ctl2 = wrap.querySelector("input:not([type='hidden']), select, textarea");
        if (ctl2 && fillControl(ctl2, value)) return { ok: true, strategy: "label-wrap", reason: ctl2.tagName };
      }
    }
  }

  // 2) aria-label match
  var aria = root.querySelectorAll("[aria-label]");
  for (var j = 0; j < aria.length; j++) {
    var a = aria[j].getAttribute("aria-label") || "";
    if (a.toLowerCase().indexOf(labelLc) >= 0) {
      if (fillControl(aria[j], value)) return { ok: true, strategy: "aria", reason: a };
    }
  }

  // 3) fieldset legend (radios)
  var fsList = root.querySelectorAll("fieldset");
  for (var k = 0; k < fsList.length; k++) {
    var fs = fsList[k];
    var legend = fs.querySelector("legend");
    if (legend && txt(legend).toLowerCase().indexOf(labelLc) >= 0) {
      var radios = fs.querySelectorAll("input[type='radio']");
      for (var m = 0; m < radios.length; m++) {
        var r = radios[m];
        var rlbl = txt(r.closest("label")) + " " + (r.value || "");
        if (rlbl.toLowerCase().indexOf(String(value).toLowerCase()) >= 0) {
          if (!r.checked) r.click();
          return { ok: true, strategy: "radio", reason: rlbl };
        }
      }
      return { ok: false, strategy: "radio", reason: "no radio matched value " + String(value) };
    }
  }

  return { ok: false, strategy: "none", reason: "no label/aria/fieldset matched \\"" + labelLc + "\\"" };
})
`;

async function fillFieldByLabel(page: Page, id: string, label: string, value: any): Promise<boolean> {
  try {
    const frame = (page as any)._modalFrame ?? (await pickModalFrame(page));
    if (!frame) {
      console.log(`[linkedin]       fill-script: no frame holds the modal`);
      return false;
    }
    // FILL_FIELD_SCRIPT is a function expression — invoke it inline with the
    // args JSON-serialized into the script string. (When `evaluate` gets a
    // string, it just evaluates the expression — it won't auto-call our IIFE
    // unless we end with `(arg)`.)
    const argJson = JSON.stringify({ id, label, value });
    const invoked = `${FILL_FIELD_SCRIPT}(${argJson});`;
    const res = (await frame.evaluate(invoked as any)) as any;
    if (typeof res === "boolean") {
      console.log(`[linkedin]       fill-script returned bare boolean ${res}`);
      return res;
    }
    if (res && typeof res === "object") {
      console.log(
        `[linkedin]       fill-script: strategy=${res.strategy} ok=${res.ok} reason=${res.reason ?? ""}`
      );
      return !!res.ok;
    }
    console.log(`[linkedin]       fill-script returned ${JSON.stringify(res)}`);
    return false;
  } catch (e: any) {
    console.log(`[linkedin]       fill-script threw: ${e?.message ?? e}`);
    return false;
  }
}

/**
 * Scrape inline validation errors from the modal. LinkedIn renders error
 * messages as siblings of the offending input, usually with classes like
 * `artdeco-inline-feedback--error` or role="alert".
 */
async function collectInlineErrors(
  frame: any
): Promise<Array<{ message: string; forId?: string; label?: string }>> {
  const script = `(function(){
    var root = document.querySelector("div.jobs-easy-apply-content")
      || document.querySelector("div.jobs-easy-apply-modal")
      || document.querySelector("div[data-test-modal]")
      || document.querySelector("div.artdeco-modal")
      || document.querySelector("div[role='dialog']")
      || document.querySelector("dialog");
    if (!root) return [];
    function txt(el) { return ((el && el.textContent) ? el.textContent : "").replace(/\\s+/g, " ").trim(); }
    var nodes = root.querySelectorAll(".artdeco-inline-feedback--error, [role='alert'], .fb-dash-form-element__error-text, .fb-form-element-validation--error");
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var msg = txt(n);
      if (!msg) continue;
      // Try to find the nearest form element wrapper and its label.
      var wrap = n.closest("div.fb-dash-form-element, fieldset, label");
      var forId = "";
      var label = "";
      if (wrap) {
        var ctl = wrap.querySelector("input:not([type='hidden']), select, textarea");
        if (ctl) forId = ctl.id || ctl.name || "";
        var lbl = wrap.querySelector("label, legend");
        if (lbl) label = txt(lbl);
      }
      out.push({ message: msg, forId: forId, label: label });
    }
    return out;
  })();`;
  try {
    return ((await frame.evaluate(script)) as any[]) ?? [];
  } catch (e: any) {
    console.log(`[linkedin] collectInlineErrors threw: ${e?.message ?? e}`);
    return [];
  }
}

/**
 * Click a button inside the Easy Apply modal by its text or aria-label.
 * Scopes the click to the modal root so we don't accidentally click a
 * matching button on the surrounding job page.
 */
async function clickModalButton(
  frame: any,
  info: { text: string; aria: string }
): Promise<boolean> {
  const argJson = JSON.stringify(info);
  const script = `(function(arg){
    var root = document.querySelector("div.jobs-easy-apply-content")
      || document.querySelector("div.jobs-easy-apply-modal")
      || document.querySelector("div[data-test-modal]")
      || document.querySelector("div.artdeco-modal")
      || document.querySelector("div[role='dialog']")
      || document.querySelector("dialog");
    if (!root) return { ok: false, reason: "no root" };
    var bs = root.querySelectorAll('button');
    for (var i = 0; i < bs.length; i++) {
      var b = bs[i];
      var txt = (b.innerText || '').trim();
      var aria = b.getAttribute('aria-label') || '';
      if ((arg.text && txt === arg.text) || (arg.aria && aria === arg.aria)) {
        b.scrollIntoView({ block: 'center' });
        b.click();
        return { ok: true, clicked: txt || aria };
      }
    }
    return { ok: false, reason: "no match" };
  })(${argJson});`;
  try {
    const res = (await frame.evaluate(script)) as any;
    console.log(`[linkedin]   clickModalButton: ${JSON.stringify(res)}`);
    return !!res?.ok;
  } catch (e: any) {
    console.log(`[linkedin]   clickModalButton threw: ${e?.message ?? e}`);
    return false;
  }
}

function jobIdOf(url: string): string | null {
  try {
    const u = new URL(url);
    return (
      u.pathname.match(/(\d{8,})/)?.[1] ?? u.searchParams.get("currentJobId") ?? null
    );
  } catch {
    return null;
  }
}

/**
 * Strip regional subdomains and convert slug URLs to the canonical
 * `https://www.linkedin.com/jobs/view/<id>/` form.
 */
function normalizeJobUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hostname = "www.linkedin.com";
    // Pull a numeric job id from path or query (?currentJobId=)
    const fromPath = u.pathname.match(/(\d{8,})/)?.[1];
    const fromQuery = u.searchParams.get("currentJobId");
    const id = fromPath ?? fromQuery;
    if (id) {
      u.pathname = `/jobs/view/${id}/`;
      u.search = "";
    }
    return u.toString();
  } catch {
    return url;
  }
}
