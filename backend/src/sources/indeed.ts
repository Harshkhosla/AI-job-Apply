import path from "node:path";
import fs from "node:fs";
import { chromium, type BrowserContext } from "playwright";
import type { NormalizedJob } from "../types.js";

/**
 * Indeed scraper backed by a persistent Playwright Chromium session.
 *
 * Why Playwright instead of plain fetch+cheerio: Indeed aggressively serves
 * Cloudflare challenges and bot-detection HTML to non-browser clients, so
 * a real Chromium with a persistent profile is far more reliable.
 *
 * The profile lives at backend/data/playwright/indeed-profile, separate from
 * greenhouse-profile and chrome-profile (LinkedIn) so cookies don't collide.
 *
 * Tunables (env vars):
 *   INDEED_HEADLESS=1   run without a visible window
 */
const PROFILE_DIR = path.resolve(process.cwd(), "data", "playwright", "indeed-profile");

let _ctx: BrowserContext | null = null;

/**
 * Shared persistent Chromium context for Indeed. Used by both the scraper and
 * the apply bot so they reuse cookies / login state.
 *
 * Defaults to headless. Set INDEED_HEADLESS=0 to show the window (useful when
 * you need to solve a Cloudflare challenge or sign in to Indeed).
 */
export async function getIndeedContext(): Promise<BrowserContext> {
  if (_ctx) return _ctx;
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  const headless = process.env.INDEED_HEADLESS !== "0";
  _ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless,
    slowMo: 30,
    viewport: { width: 1280, height: 900 },
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
      "--no-sandbox",
      "--disable-web-security",
      "--lang=en-IN,en-US,en",
    ],
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    extraHTTPHeaders: {
      "Accept-Language": "en-IN,en-US;q=0.9,en;q=0.8",
    },
  });

  // Stealth: hide every signal Indeed/Cloudflare uses to detect headless
  // Chromium. This is the minimum set that gets us past the bot wall.
  await _ctx.addInitScript(() => {
    // 1. navigator.webdriver -> undefined
    Object.defineProperty(Navigator.prototype, "webdriver", {
      get: () => undefined,
      configurable: true,
    });
    // 2. plugins / mimeTypes — headless has zero by default
    const fakePlugins = [
      { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer", description: "Portable Document Format" },
      { name: "Chrome PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai", description: "" },
      { name: "Native Client", filename: "internal-nacl-plugin", description: "" },
    ];
    Object.defineProperty(navigator, "plugins", {
      get: () => fakePlugins,
      configurable: true,
    });
    Object.defineProperty(navigator, "mimeTypes", {
      get: () => [{ type: "application/pdf", suffixes: "pdf", description: "" }],
      configurable: true,
    });
    // 3. languages
    Object.defineProperty(navigator, "languages", {
      get: () => ["en-IN", "en-US", "en"],
      configurable: true,
    });
    // 4. window.chrome stub (only present in real Chrome)
    (window as any).chrome = (window as any).chrome || {
      runtime: {},
      app: { isInstalled: false },
      csi: () => undefined,
      loadTimes: () => undefined,
    };
    // 5. Permissions API consistency
    const origQuery = (window.navigator.permissions as any)?.query;
    if (origQuery) {
      (window.navigator.permissions as any).query = (params: any) =>
        params?.name === "notifications"
          ? Promise.resolve({ state: Notification.permission })
          : origQuery(params);
    }
    // 6. WebGL vendor — headless reports "SwiftShader"; spoof to Intel.
    const proto = (WebGLRenderingContext as any)?.prototype;
    if (proto?.getParameter) {
      const orig = proto.getParameter;
      proto.getParameter = function (p: number) {
        if (p === 37445) return "Intel Inc."; // UNMASKED_VENDOR_WEBGL
        if (p === 37446) return "Intel Iris OpenGL Engine"; // UNMASKED_RENDERER_WEBGL
        return orig.call(this, p);
      };
    }
  });

  return _ctx;
}

export async function closeIndeedBrowser(): Promise<void> {
  if (_ctx) await _ctx.close().catch(() => undefined);
  _ctx = null;
}

/** Parse Indeed's relative "posted" strings into a real Date. */
function parsePostedAt(raw: string | undefined | null): Date | undefined {
  if (!raw) return undefined;
  const s = raw.toLowerCase().replace(/^posted\s*/i, "").trim();
  if (!s) return undefined;
  if (/^(just posted|today|active today)/.test(s)) return new Date();
  const m = s.match(/(\d+)\s*\+?\s*(minute|hour|day|week|month)/);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  const unit = m[2];
  const now = Date.now();
  const ms =
    unit === "minute" ? n * 60_000 :
    unit === "hour" ? n * 3_600_000 :
    unit === "day" ? n * 86_400_000 :
    unit === "week" ? n * 7 * 86_400_000 :
    unit === "month" ? n * 30 * 86_400_000 :
    0;
  return new Date(now - ms);
}

function pickHost(location: string): string {
  const l = location.toLowerCase().trim();
  // Use the India domain for India-based searches so we get INR / IST listings;
  // fall back to .com for Remote and everything else.
  if (!l || l === "remote") return "https://www.indeed.com";
  if (/\bindia\b|bengaluru|bangalore|hyderabad|pune|mumbai|delhi|noida|gurgaon|gurugram|chennai|kolkata|ahmedabad/.test(l))
    return "https://in.indeed.com";
  return "https://www.indeed.com";
}

/**
 * Search Indeed for jobs matching the query+location. Always sorts by date
 * (newest first); applies `fromage` (days) if `withinHours` is provided.
 */
export async function fetchIndeed(
  query: string,
  location = "",
  pages = 1,
  withinHours?: number
): Promise<NormalizedJob[]> {
  const jobs: NormalizedJob[] = [];
  const host = pickHost(location);
  const isRemote = location.toLowerCase().trim() === "remote";

  const fromageDays = withinHours ? Math.max(1, Math.ceil(withinHours / 24)) : undefined;

let ctx = await getIndeedContext();
  let existing = ctx.pages();
  let currentPage = existing.length > 0 ? existing[existing.length - 1] : await ctx.newPage();

  for (let p = 0; p < pages; p++) {
    const start = p * 10;
    const params = new URLSearchParams();
    params.set("q", query);
    if (!isRemote) params.set("l", location);
    if (isRemote) params.set("remotejob", "1");
    params.set("sort", "date");
    if (fromageDays !== undefined) params.set("fromage", String(fromageDays));
    if (start > 0) params.set("start", String(start));
    const url = `${host}/jobs?${params.toString()}`;

    console.log(`[indeed] page ${p + 1}/${pages} → ${url}`);
    try {
      await currentPage.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    } catch (e: any) {
      console.warn(`[indeed] navigation failed: ${e?.message ?? e}`);
      break;
    }

    // Auto-escalate from headless → headed if we hit a Cloudflare wall.
    if (await isBlocked(currentPage)) {
      const isHeadless = process.env.INDEED_HEADLESS !== "0";
      if (isHeadless) {
        console.warn(
          "[indeed] Cloudflare wall detected in headless mode — restarting Chromium visibly so you can solve it once."
        );
        await closeIndeedBrowser();
        process.env.INDEED_HEADLESS = "0";
        ctx = await getIndeedContext();
        existing = ctx.pages();
        currentPage = existing.length > 0 ? existing[existing.length - 1] : await ctx.newPage();
        await currentPage.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
      }
      console.warn(
        "[indeed] Solve the challenge in the visible window. Waiting up to 180s..."
      );
      await currentPage
        .waitForSelector(
          "a[href*='/viewjob?'], a[href*='/rc/clk?'], div.job_seen_beacon, [data-testid='slider_item']",
          { timeout: 180_000 }
        )
        .catch(() => undefined);
    }

    // Wait for the results list to be populated. Indeed hydrates cards via JS,
    // so domcontentloaded isn't enough — wait for at least one job anchor.
    await currentPage
      .waitForSelector(
        "a[href*='/viewjob?'], a[href*='/rc/clk?'], div.job_seen_beacon, [data-testid='slider_item']",
        { timeout: 25_000 }
      )
      .catch(() => undefined);
    await currentPage.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
    await currentPage.waitForTimeout(800);

    const cards = await extractCards(currentPage);
    console.log(`[indeed] page ${p + 1}: extracted ${cards.length} cards`);
    if (cards.length === 0) {
      const html = await currentPage.content().catch(() => "");
      const hasResults = /mosaic-jobResults|job_seen_beacon|jobsearch-ResultsList/.test(html);
      const hasNoResults = /did not match any jobs|no results|0 jobs found/i.test(html);
      const blocked = await isBlocked(currentPage);
      console.warn(
        `[indeed]   diagnostic: results-container=${hasResults} no-results-page=${hasNoResults} blocked=${blocked} url=${currentPage.url()}`
      );
      break;
    }

    for (const c of cards) {
      if (!c.title || !c.jk) continue;
      jobs.push({
        source: "indeed",
        sourceJobId: c.jk,
        url: `${host}/viewjob?jk=${c.jk}`,
        company: c.company || "Unknown",
        title: c.title,
        location: c.location,
        remote: /remote/i.test(c.location) || /remote/i.test(c.snippet),
        description: c.snippet || "",
        postedAt: parsePostedAt(c.dateRaw),
      });
    }

    await currentPage.waitForTimeout(1500 + Math.floor(Math.random() * 800));
  }

  return jobs;
}

async function isBlocked(page: any): Promise<boolean> {
  const body = (await page.locator("body").innerText().catch(() => "")) || "";
  if (
    /verify you are human|verifying you are human|just a moment|please complete the security check|additional verification required/i.test(
      body
    )
  )
    return true;
  if ((await page.locator("iframe[src*='challenges.cloudflare']").count().catch(() => 0)) > 0)
    return true;
  return false;
}

async function extractCards(page: any): Promise<any[]> {
  return page
    .evaluate(() => {
      function pickText(el: Element | null): string {
        return (el?.textContent || "").replace(/\s+/g, " ").trim();
      }
      function findCard(anchor: Element): Element {
        let n: Element | null = anchor;
        while (n && n !== document.body) {
          if (
            n.matches?.(
              "div.job_seen_beacon, [data-testid='slider_item'], li.eu4oa1w0, td.resultContent, div.cardOutline"
            )
          )
            return n;
          n = n.parentElement;
        }
        return anchor.parentElement || anchor;
      }
      function extractJk(node: Element): string {
        const own = node.getAttribute("data-jk");
        if (own) return own;
        const child = node.querySelector("[data-jk]") as HTMLElement | null;
        if (child?.getAttribute("data-jk")) return child.getAttribute("data-jk")!;
        const a = node.querySelector("a[href*='jk=']") as HTMLAnchorElement | null;
        const m = a?.href.match(/[?&]jk=([^&]+)/);
        return m?.[1] || "";
      }

      const anchors = Array.from(
        document.querySelectorAll(
          "a[href*='/viewjob?'], a[href*='/rc/clk?'], a[data-jk]"
        )
      );
      const seen = new Map<string, any>();
      for (const a of anchors) {
        const card = findCard(a);
        const jk = extractJk(card) || extractJk(a);
        if (!jk || seen.has(jk)) continue;

        const titleEl =
          card.querySelector("h2.jobTitle span[title]") ||
          card.querySelector("h2.jobTitle a span") ||
          card.querySelector("h2.jobTitle") ||
          card.querySelector("[data-testid='jobTitle']") ||
          a.querySelector("span[title]") ||
          a;
        const title =
          (titleEl as HTMLElement | null)?.getAttribute?.("title") || pickText(titleEl);

        const company =
          pickText(card.querySelector("[data-testid='company-name']")) ||
          pickText(card.querySelector("span.companyName")) ||
          pickText(card.querySelector("[data-testid='inlineHeader-companyName']")) ||
          "";

        const loc =
          pickText(card.querySelector("[data-testid='text-location']")) ||
          pickText(card.querySelector("div.companyLocation")) ||
          pickText(card.querySelector("[data-testid='inlineHeader-companyLocation']")) ||
          "";

        const snippet =
          pickText(card.querySelector("[data-testid='belowJobSnippet']")) ||
          pickText(card.querySelector("div.job-snippet")) ||
          pickText(card.querySelector("ul")) ||
          "";

        const dateRaw =
          pickText(card.querySelector("[data-testid='myJobsStateDate']")) ||
          pickText(card.querySelector("span.date")) ||
          pickText(card.querySelector("[data-testid='job-age']")) ||
          "";

        if (!title) continue;
        seen.set(jk, { jk, title, company, location: loc, snippet, dateRaw });
      }
      return Array.from(seen.values());
    })
    .catch((e: any) => {
      console.warn(`[indeed] evaluate threw: ${e?.message ?? e}`);
      return [] as any[];
    });
}
