import { chromium, type BrowserContext, type Page } from "playwright";
import path from "node:path";
import fs from "node:fs";
import type { FormField, ParsedForm, PlannedField } from "../types.js";
import type { ProfileData } from "../../types.js";
import { answerFormField } from "../../llm/claude.js";

// Persistent Chromium profile for Indeed
const PROFILE_DIR = path.resolve(process.cwd(), "data", "playwright", "indeed-profile");

let _context: BrowserContext | null = null;

/**
 * Lazily-launch a persistent Chromium context for Indeed.
 */
async function getContext(): Promise<BrowserContext> {
  if (_context) return _context;
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const headless = process.env.INDEED_HEADLESS === "1";
  _context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless,
    slowMo: 50,
    viewport: { width: 1280, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36",
  });

  return _context;
}

export async function closeBrowser(): Promise<void> {
  if (_context) await _context.close().catch(() => undefined);
  _context = null;
}

interface SessionRecord {
  page: Page;
  jobUrl: string;
}
const _sessions = new Map<string, SessionRecord>();

/**
 * Open the Indeed job posting and click "Apply now" / "Easily apply" button.
 * Extracts form fields from the application modal.
 */
export async function openIndeedJob(jobUrl: string, applicationId: string): Promise<ParsedForm> {
  const ctx = await getContext();

  // Reuse the most recent tab
  const pages = ctx.pages();
  const page = pages.length > 0 ? pages[pages.length - 1] : await ctx.newPage();
  await page.bringToFront().catch(() => undefined);

  _sessions.set(applicationId, { page, jobUrl });

  // Navigate to job page
  await page.goto(jobUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2000);

  // Handle auth wall — Indeed might require sign-in
  if (page.url().includes("/account/login") || page.url().includes("secure.indeed.com")) {
    console.log("[indeed] Not signed in. Waiting up to 3 min for you to log in...");
    try {
      await page.waitForURL((u) => !u.toString().includes("/account/login") && !u.toString().includes("secure.indeed.com"), {
        timeout: 180_000,
      });
    } catch {
      throw new Error(
        "Timed out waiting for Indeed login. Log in inside the opened Chromium window, then try again."
      );
    }
    await page.goto(jobUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2000);
  }

  // Look for "Apply now" or "Easily apply" button
  let clicked = false;
  const applySelectors = [
    'button:has-text("Apply now")',
    'button:has-text("Easily apply")',
    'button[id*="indeedApply"]',
    'a:has-text("Apply now")',
    '[data-testid="indeedApply"]',
    '.indeed-apply-button',
    'button.ia-IndeedApplyButton',
    '#applyButtonLinkContainer button',
  ];

  for (const sel of applySelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        await btn.scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        await btn.click({ timeout: 5000 });
        clicked = true;
        break;
      }
    } catch {
      // try next selector
    }
  }

  if (!clicked) {
    // Try text-based matching
    try {
      const applyText = page.locator(':text-matches("Apply now|Easily apply", "i")').first();
      await applyText.waitFor({ state: "attached", timeout: 10_000 });
      const handle = await applyText.elementHandle();
      if (handle) {
        const btn = await handle.evaluateHandle((el) => {
          const e = el as Element;
          return e.closest("button, a[href], [role='button']") || e;
        });
        const btnEl = btn.asElement();
        if (btnEl) {
          await btnEl.evaluate((b) => (b as HTMLElement).scrollIntoView({ block: "center" }));
          await page.waitForTimeout(300);
          await btnEl.click({ timeout: 10_000 });
          clicked = true;
        }
      }
    } catch {
      // fallback failed
    }
  }

  if (!clicked) {
    const dbg = path.join(PROFILE_DIR, "..", `indeed-apply-miss-${Date.now()}.png`);
    await page.screenshot({ path: dbg, fullPage: false }).catch(() => undefined);
    throw new Error(
      `No "Apply now" button found. This job may not support Indeed Apply, or the page structure changed. Screenshot: ${dbg}`
    );
  }

  // Wait for application modal/iframe to appear
  await page.waitForTimeout(2500);

  // Indeed often opens apply in an iframe or new page
  let applyFrame = page;
  const iframe = page.frameLocator('iframe[id*="indeed-apply"], iframe[src*="indeed.com/applystart"]').first();
  
  // Check if we need to work with an iframe
  try {
    const iframeExists = await page.locator('iframe[id*="indeed-apply"], iframe[src*="indeed.com/applystart"]').count();
    if (iframeExists > 0) {
      // Work within the iframe
      console.log("[indeed] Application opened in iframe");
    }
  } catch {
    // No iframe, continue with main page
  }

  // Extract fields from the current step
  const fields = await extractFieldsFromPage(page);
  console.log(`[indeed] plan: extracted ${fields.length} fields`);
  for (const f of fields) {
    console.log(`[indeed]   - id="${f.id}" label="${f.label}" type=${f.type} req=${f.required}`);
  }

  return {
    source: "indeed" as any,
    jobBoardToken: "indeed",
    jobId: jobUrl,
    applyUrl: jobUrl,
    fields,
  };
}

/**
 * Extract form fields from the Indeed application page/modal.
 */
async function extractFieldsFromPage(page: Page): Promise<FormField[]> {
  const fields: FormField[] = [];

  // Extract using page.evaluate for robustness
  const rawFields = await page.evaluate(() => {
    const result: any[] = [];
    
    // Find all input elements
    const inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"])');
    inputs.forEach((input: any, idx) => {
      const label = input.labels?.[0]?.textContent?.trim() ||
                    input.getAttribute('aria-label') ||
                    input.getAttribute('placeholder') ||
                    input.name ||
                    `field_${idx}`;
      const id = input.id || input.name || `input_${idx}`;
      const type = input.type || 'text';
      const required = input.required || input.getAttribute('aria-required') === 'true';
      
      result.push({
        id,
        label,
        type: type === 'tel' ? 'phone' : type === 'email' ? 'email' : type === 'file' ? 'file' : 'text',
        required,
        currentValue: input.value || '',
      });
    });

    // Find textareas
    const textareas = document.querySelectorAll('textarea');
    textareas.forEach((ta: any, idx) => {
      const label = ta.labels?.[0]?.textContent?.trim() ||
                    ta.getAttribute('aria-label') ||
                    ta.getAttribute('placeholder') ||
                    ta.name ||
                    `textarea_${idx}`;
      result.push({
        id: ta.id || ta.name || `textarea_${idx}`,
        label,
        type: 'textarea',
        required: ta.required,
        currentValue: ta.value || '',
      });
    });

    // Find select dropdowns
    const selects = document.querySelectorAll('select');
    selects.forEach((sel: any, idx) => {
      const label = sel.labels?.[0]?.textContent?.trim() ||
                    sel.getAttribute('aria-label') ||
                    sel.name ||
                    `select_${idx}`;
      const options = Array.from(sel.options).map((opt: any) => ({
        value: opt.value,
        label: opt.textContent?.trim() || opt.value,
      }));
      result.push({
        id: sel.id || sel.name || `select_${idx}`,
        label,
        type: 'select',
        required: sel.required,
        options,
        currentValue: sel.value || '',
      });
    });

    // Find radio button groups
    const radioGroups = new Map<string, any>();
    document.querySelectorAll('input[type="radio"]').forEach((radio: any) => {
      const name = radio.name;
      if (!radioGroups.has(name)) {
        const fieldset = radio.closest('fieldset');
        const label = fieldset?.querySelector('legend')?.textContent?.trim() ||
                      radio.getAttribute('aria-label') ||
                      name;
        radioGroups.set(name, {
          id: name,
          label,
          type: 'select',
          required: radio.required,
          options: [],
          currentValue: '',
        });
      }
      const group = radioGroups.get(name);
      group.options.push({
        value: radio.value,
        label: radio.labels?.[0]?.textContent?.trim() || radio.value,
      });
      if (radio.checked) group.currentValue = radio.value;
    });
    radioGroups.forEach((group) => result.push(group));

    // Find checkboxes (yes/no questions)
    document.querySelectorAll('input[type="checkbox"]').forEach((cb: any, idx) => {
      const label = cb.labels?.[0]?.textContent?.trim() ||
                    cb.getAttribute('aria-label') ||
                    cb.name ||
                    `checkbox_${idx}`;
      result.push({
        id: cb.id || cb.name || `checkbox_${idx}`,
        label,
        type: 'yes_no',
        required: cb.required,
        currentValue: cb.checked ? 'yes' : 'no',
      });
    });

    return result;
  });

  for (const f of rawFields) {
    fields.push({
      id: f.id,
      label: f.label,
      type: f.type as any,
      required: f.required,
      options: f.options,
      currentValue: f.currentValue,
    });
  }

  return fields;
}

/**
 * Fill the Indeed application form with planned values.
 */
export async function fillIndeedForm(
  applicationId: string,
  values: PlannedField[],
  profile?: ProfileData,
  context?: { jobTitle: string; jobCompany: string; jobDescription: string },
  resumePath?: string
): Promise<{ filled: string[]; skipped: { id: string; reason: string }[]; reviewUrl: string }> {
  const sess = _sessions.get(applicationId);
  if (!sess) throw new Error("No active Indeed session — call openIndeedJob first.");
  const page = sess.page;

  const filled: string[] = [];
  const skipped: { id: string; reason: string }[] = [];

  const valuesById = new Map<string, PlannedField>();
  const valuesByLabel = new Map<string, PlannedField>();
  for (const v of values) {
    valuesById.set(v.id, v);
    valuesByLabel.set(v.label.toLowerCase(), v);
  }

  console.log("[indeed] ==== fill begin ====");

  const MAX_STEPS = 6;
  for (let step = 0; step < MAX_STEPS; step++) {
    const stepFields = await extractFieldsFromPage(page);
    console.log(`[indeed] -- step ${step + 1}: ${stepFields.length} fields --`);

    for (const field of stepFields) {
      const planned = valuesById.get(field.id) || valuesByLabel.get(field.label.toLowerCase());
      if (!planned || planned.value === null || planned.value === undefined || planned.value === "") {
        if (field.required) {
          skipped.push({ id: field.id, reason: "No value planned" });
        }
        continue;
      }

      try {
        await fillField(page, field, planned.value, resumePath);
        filled.push(field.id);
        console.log(`[indeed]   ✓ filled ${field.id} = ${JSON.stringify(planned.value).slice(0, 50)}`);
      } catch (e: any) {
        console.log(`[indeed]   ✗ failed ${field.id}: ${e?.message}`);
        skipped.push({ id: field.id, reason: e?.message ?? String(e) });
      }
    }

    // Look for Next/Continue button
    const nextBtn = page.locator('button:has-text("Continue"), button:has-text("Next"), button[type="submit"]:not(:has-text("Submit"))').first();
    const submitBtn = page.locator('button:has-text("Submit"), button:has-text("Apply"), button:has-text("Send application")').first();

    const hasNext = await nextBtn.isVisible({ timeout: 2000 }).catch(() => false);
    const hasSubmit = await submitBtn.isVisible({ timeout: 1000 }).catch(() => false);

    if (hasSubmit && !hasNext) {
      console.log("[indeed] Reached review/submit step. Bot stops here — click Submit manually.");
      break;
    }

    if (hasNext) {
      await nextBtn.click({ timeout: 5000 });
      await page.waitForTimeout(1500);
    } else {
      // No next or submit button found, might be single-page form
      break;
    }
  }

  return {
    filled,
    skipped,
    reviewUrl: page.url(),
  };
}

/**
 * Fill a single form field based on its type.
 */
async function fillField(page: Page, field: FormField, value: any, resumePath?: string): Promise<void> {
  const selector = field.id.startsWith('#') ? field.id : `#${field.id}, [name="${field.id}"], [aria-label*="${field.label}"]`;

  switch (field.type) {
    case "text":
    case "email":
    case "phone":
    case "url":
    case "number": {
      const input = page.locator(`input${selector.includes('#') ? selector : `[id="${field.id}"], input[name="${field.id}"]`}`).first();
      await input.fill(String(value));
      break;
    }
    case "textarea": {
      const ta = page.locator(`textarea[id="${field.id}"], textarea[name="${field.id}"]`).first();
      await ta.fill(String(value));
      break;
    }
    case "select": {
      const sel = page.locator(`select[id="${field.id}"], select[name="${field.id}"]`).first();
      const isSelect = await sel.count() > 0;
      if (isSelect) {
        await sel.selectOption(String(value));
      } else {
        // Might be radio buttons
        const radio = page.locator(`input[type="radio"][name="${field.id}"][value="${value}"]`).first();
        await radio.check();
      }
      break;
    }
    case "yes_no":
    case "checkbox": {
      const cb = page.locator(`input[type="checkbox"][id="${field.id}"], input[type="checkbox"][name="${field.id}"]`).first();
      const shouldCheck = value === true || value === "yes" || value === "Yes" || value === "1";
      if (shouldCheck) {
        await cb.check();
      } else {
        await cb.uncheck();
      }
      break;
    }
    case "file": {
      if (resumePath && fs.existsSync(resumePath)) {
        const fileInput = page.locator(`input[type="file"][id="${field.id}"], input[type="file"][name="${field.id}"]`).first();
        await fileInput.setInputFiles(resumePath);
      }
      break;
    }
    default:
      console.log(`[indeed] Unknown field type: ${field.type}`);
  }
}
