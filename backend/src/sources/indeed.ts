import { chromium, type BrowserContext, type Page } from "playwright";
import path from "node:path";
import fs from "node:fs";
import type { NormalizedJob } from "../types.js";

// Persistent browser profile for Indeed scraping - stores cookies/session
const PROFILE_DIR = path.resolve(process.cwd(), "data", "playwright", "indeed-scrape-profile");
let _context: BrowserContext | null = null;

/**
 * Launch a stealth browser context that bypasses bot detection.
 * Runs in VISIBLE mode by default for debugging - set INDEED_HEADLESS=1 to hide.
 */
async function getScraperContext(): Promise<BrowserContext> {
  if (_context) return _context;
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  // Default to visible browser for debugging Indeed's anti-bot measures
  const headless = process.env.INDEED_HEADLESS === "1";
  console.log(`[indeed] Launching browser (headless: ${headless})...`);

  _context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless,
    slowMo: 50,
    viewport: { width: 1366, height: 768 },
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
      "--disable-web-security",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--disable-gpu",
    ],
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.6533.100 Safari/537.36",
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    geolocation: { latitude: 12.9716, longitude: 77.5946 }, // Bangalore
    permissions: ["geolocation"],
  });

  // Apply stealth scripts to evade detection
  _context.addInitScript(() => {
    // Override webdriver property
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    
    // Override plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });
    
    // Override languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en', 'hi'],
    });
    
    // Mock chrome runtime
    (window as any).chrome = { runtime: {} };
  });

  return _context;
}

export async function closeIndeedScraper(): Promise<void> {
  if (_context) await _context.close().catch(() => undefined);
  _context = null;
}

/**
 * Simulate human-like scrolling behavior
 */
async function humanScroll(page: Page): Promise<void> {
  const scrollHeight = await page.evaluate(() => document.body.scrollHeight);
  let currentPosition = 0;
  
  while (currentPosition < scrollHeight * 0.7) {
    const scrollStep = 200 + Math.random() * 300;
    currentPosition += scrollStep;
    await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'smooth' }), currentPosition);
    await page.waitForTimeout(100 + Math.random() * 200);
  }
  
  // Scroll back up a bit (human behavior)
  await page.evaluate(() => window.scrollTo({ top: 200, behavior: 'smooth' }));
  await page.waitForTimeout(300);
}

/**
 * Handle CAPTCHA or verification pages - waits for user to solve manually
 */
async function handleVerification(page: Page): Promise<boolean> {
  const isCaptcha = await page.evaluate(() => {
    const text = document.body.innerText.toLowerCase();
    return text.includes('verify you are human') || 
           text.includes('captcha') ||
           text.includes('unusual traffic') ||
           document.querySelector('iframe[src*="captcha"]') !== null ||
           document.querySelector('#px-captcha') !== null;
  });

  if (isCaptcha) {
    console.log("[indeed] ⚠️ CAPTCHA detected! Please solve it in the browser window...");
    console.log("[indeed] Waiting up to 2 minutes for manual verification...");
    
    try {
      await page.waitForFunction(() => {
        const text = document.body.innerText.toLowerCase();
        return !text.includes('verify you are human') && 
               !text.includes('captcha') &&
               document.querySelector('.job_seen_beacon, .jobsearch-ResultsList') !== null;
      }, { timeout: 120000 });
      
      console.log("[indeed] ✓ Verification complete!");
      return true;
    } catch {
      console.log("[indeed] ✗ Verification timeout");
      return false;
    }
  }
  return true;
}

/**
 * Get the correct Indeed domain based on location
 */
function getIndeedDomain(location: string): string {
  const loc = location.toLowerCase();
  if (loc.includes("india") || loc.includes("bengaluru") || loc.includes("bangalore") || 
      loc.includes("mumbai") || loc.includes("delhi") || loc.includes("hyderabad") ||
      loc.includes("chennai") || loc.includes("pune") || loc.includes("kolkata")) {
    return "https://in.indeed.com";
  }
  if (loc.includes("uk") || loc.includes("london")) return "https://uk.indeed.com";
  if (loc.includes("canada")) return "https://ca.indeed.com";
  if (loc.includes("australia")) return "https://au.indeed.com";
  return "https://www.indeed.com";
}

/**
 * Indeed scraper using Playwright to bypass bot detection.
 * Features:
 * - Stealth mode to evade detection
 * - Human-like scrolling behavior
 * - CAPTCHA handling (waits for manual solve)
 * - Persistent session/cookies
 * - Multi-region support (India, US, UK, etc.)
 * - Robust selectors with fallbacks
 */
export async function fetchIndeed(
  query: string,
  location = "",
  pages = 1,
  withinHours?: number
): Promise<NormalizedJob[]> {
  const jobs: NormalizedJob[] = [];
  const ctx = await getScraperContext();
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.bringToFront();

  // Indeed supports a "days ago" filter: fromage=N (rounded up from hours)
  const fromage = withinHours ? `&fromage=${Math.max(1, Math.ceil(withinHours / 24))}` : "";
  const baseUrl = getIndeedDomain(location);

  console.log(`[indeed] Starting scrape - Query: "${query}", Location: "${location}", Pages: ${pages}`);
  console.log(`[indeed] Using domain: ${baseUrl}`);

  // First, go to Indeed homepage to establish session
  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);
    
    // Handle cookie consent
    const cookieBtn = page.locator('#onetrust-accept-btn-handler, button:has-text("Accept")').first();
    if (await cookieBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await cookieBtn.click();
      await page.waitForTimeout(500);
    }
  } catch (e) {
    console.log("[indeed] Failed to load homepage, continuing anyway...");
  }

  for (let pageNum = 0; pageNum < pages; pageNum++) {
    const start = pageNum * 10;
    const indeedUrl =
      `${baseUrl}/jobs?q=${encodeURIComponent(query)}` +
      `&l=${encodeURIComponent(location)}&start=${start}${fromage}`;

    console.log(`[indeed] Page ${pageNum + 1}: ${indeedUrl}`);
    
    try {
      // Navigate with retry logic
      let navSuccess = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await page.goto(indeedUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
          navSuccess = true;
          break;
        } catch (e) {
          console.log(`[indeed] Navigation attempt ${attempt + 1} failed, retrying...`);
          await page.waitForTimeout(2000);
        }
      }
      if (!navSuccess) throw new Error("Navigation failed after 3 attempts");

      await page.waitForTimeout(1500 + Math.random() * 1000);

      // Handle cookie consent popup
      try {
        const cookieSelectors = [
          '#onetrust-accept-btn-handler',
          'button:has-text("Accept")',
          'button:has-text("Accept All")',
          'button:has-text("I agree")',
          '[data-testid="cookie-accept"]',
        ];
        for (const sel of cookieSelectors) {
          const btn = page.locator(sel).first();
          if (await btn.isVisible({ timeout: 1000 })) {
            await btn.click();
            await page.waitForTimeout(500);
            break;
          }
        }
      } catch {
        // No cookie banner
      }

      // Check for CAPTCHA/verification
      const verified = await handleVerification(page);
      if (!verified) {
        console.log("[indeed] Skipping page due to verification failure");
        continue;
      }

      // Wait for job cards with multiple selector fallbacks
      const cardSelectors = [
        '.job_seen_beacon',
        '.jobsearch-ResultsList li',
        '[data-testid="jobListing"]',
        '.mosaic-zone',
        '#mosaic-jobResults',
      ];
      
      let foundCards = false;
      for (const sel of cardSelectors) {
        try {
          await page.waitForSelector(sel, { timeout: 5000 });
          foundCards = true;
          break;
        } catch {
          continue;
        }
      }

      if (!foundCards) {
        console.log("[indeed] No job cards found on this page - trying alternative extraction...");
        // Take screenshot for debugging
        const screenshotPath = path.join(PROFILE_DIR, "..", `indeed-debug-${Date.now()}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
        console.log(`[indeed] Debug screenshot saved: ${screenshotPath}`);
        
        // Print page content for debugging
        const pageText = await page.evaluate(() => document.body.innerText.slice(0, 500));
        console.log(`[indeed] Page content preview: ${pageText}`);
        
        // Try waiting longer and scrolling
        await page.waitForTimeout(3000);
        await humanScroll(page);
      }

      // Human-like scrolling to load lazy content
      await humanScroll(page);
      await page.waitForTimeout(1000);

      // Extract job cards with comprehensive selectors
      const pageJobs = await page.evaluate((baseUrlArg: string) => {
        const results: any[] = [];
        const seen = new Set<string>();
        
        // Method 1: Find all job cards by looking for job links
        // Indeed uses different structures for different regions, so we try multiple approaches
        
        // Approach A: Find cards with data-jk attribute (most reliable)
        document.querySelectorAll('[data-jk]').forEach((el) => {
          const jk = el.getAttribute('data-jk');
          if (!jk || seen.has(jk)) return;
          seen.add(jk);
          
          const card = el.closest('.job_seen_beacon, .resultContent, li, .slider_item') || el;
          
          // Extract title
          let title = '';
          const titleEl = card.querySelector('h2 span, .jobTitle span, a[data-jk] span, [data-testid="job-title"]');
          title = titleEl?.textContent?.trim() || titleEl?.getAttribute('title') || '';
          
          // Extract company
          let company = '';
          const companyEl = card.querySelector('[data-testid="company-name"], .companyName, .company');
          company = companyEl?.textContent?.trim() || 'Unknown';
          
          // Extract location  
          let loc = '';
          const locEl = card.querySelector('[data-testid="text-location"], .companyLocation, .location');
          loc = locEl?.textContent?.trim() || '';
          
          // Check easy apply
          const easyApply = card.textContent?.toLowerCase().includes('easily apply') || false;
          
          if (title) {
            results.push({ jk, title, company, location: loc, easyApply, remote: loc.toLowerCase().includes('remote') });
          }
        });
        
        // Approach B: Find all links that point to viewjob
        if (results.length === 0) {
          document.querySelectorAll('a[href*="/viewjob"], a[href*="jk="]').forEach((link) => {
            const href = link.getAttribute('href') || '';
            const match = href.match(/jk=([a-f0-9]+)/i);
            const jk = match?.[1];
            
            if (!jk || seen.has(jk)) return;
            seen.add(jk);
            
            // Get the parent card
            const card = link.closest('li, .job_seen_beacon, .resultContent, div[class*="job"]') || link.parentElement;
            
            // Title from the link itself
            let title = link.textContent?.trim()?.split('\n')[0] || '';
            if (title.length < 3) {
              const span = link.querySelector('span');
              title = span?.textContent?.trim() || span?.getAttribute('title') || '';
            }
            
            // Company and location from siblings
            let company = 'Unknown';
            let loc = '';
            if (card) {
              const companyEl = card.querySelector('.companyName, [data-testid="company-name"], .company');
              company = companyEl?.textContent?.trim() || 'Unknown';
              
              const locEl = card.querySelector('.companyLocation, [data-testid="text-location"], .location');
              loc = locEl?.textContent?.trim() || '';
            }
            
            const easyApply = card?.textContent?.toLowerCase().includes('easily apply') || false;
            
            if (title && title.length > 3 && !title.toLowerCase().includes('apply') && !title.toLowerCase().includes('save')) {
              results.push({ jk, title: title.slice(0, 100), company, location: loc, easyApply, remote: loc.toLowerCase().includes('remote') });
            }
          });
        }
        
        // Approach C: For Indeed India - look for mosaic structure
        if (results.length === 0) {
          document.querySelectorAll('.mosaic-zone li, #mosaic-jobResults li, .jobsearch-ResultsList li').forEach((li, idx) => {
            const link = li.querySelector('a[href*="jk="], a[href*="/viewjob"]') as HTMLAnchorElement;
            if (!link) return;
            
            const href = link.href || link.getAttribute('href') || '';
            const match = href.match(/jk=([a-f0-9]+)/i);
            const jk = match?.[1] || `temp_${idx}`;
            
            if (seen.has(jk)) return;
            seen.add(jk);
            
            const titleEl = li.querySelector('h2, .jobTitle, [class*="title"]');
            const title = titleEl?.textContent?.trim() || link.textContent?.trim()?.split('\n')[0] || '';
            
            const companyEl = li.querySelector('.companyName, [class*="company"]');
            const company = companyEl?.textContent?.trim() || 'Unknown';
            
            const locEl = li.querySelector('.companyLocation, [class*="location"]');
            const loc = locEl?.textContent?.trim() || '';
            
            if (title && title.length > 3) {
              results.push({ jk, title: title.slice(0, 100), company, location: loc, easyApply: false, remote: loc.toLowerCase().includes('remote') });
            }
          });
        }
        
        return results;
      }, baseUrl);

      console.log(`[indeed] Page ${pageNum + 1}: extracted ${pageJobs.length} jobs`);

      // Add to results avoiding duplicates
      for (const j of pageJobs) {
        if (jobs.some(existing => existing.sourceJobId === j.jk)) continue;
        
        jobs.push({
          source: "indeed",
          sourceJobId: j.jk,
          url: `${baseUrl}/viewjob?jk=${j.jk}`,
          company: j.company,
          title: j.title,
          location: j.location,
          remote: j.remote,
          easyApply: j.easyApply,
          employmentType: j.employmentType || undefined,
          description: "", // Hydrated separately
        });
      }

      // Random delay between pages (human-like)
      const delay = 2000 + Math.random() * 2000;
      console.log(`[indeed] Waiting ${Math.round(delay / 1000)}s before next page...`);
      await page.waitForTimeout(delay);

    } catch (e: any) {
      console.log(`[indeed] Error on page ${pageNum + 1}: ${e?.message}`);
      // Take debug screenshot
      const screenshotPath = path.join(PROFILE_DIR, "..", `indeed-error-${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {});
      
      // Continue to next page instead of breaking
      await page.waitForTimeout(3000);
    }
  }

  console.log(`[indeed] ✓ Scrape complete! Total jobs: ${jobs.length}`);
  return jobs;
}

/**
 * Fetch full job description from Indeed job detail page using Playwright.
 */
export async function fetchIndeedJobDetail(jobKey: string, location = ""): Promise<string> {
  const ctx = await getScraperContext();
  const page = ctx.pages()[0] || await ctx.newPage();
  
  const baseUrl = getIndeedDomain(location);
  const jobUrl = `${baseUrl}/viewjob?jk=${jobKey}`;

  try {
    await page.goto(jobUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1500 + Math.random() * 500);

    // Handle CAPTCHA if present
    await handleVerification(page);

    // Extract job description with multiple selectors
    const jobData = await page.evaluate(() => {
      // Description selectors
      const descSelectors = [
        '#jobDescriptionText',
        '[data-testid="jobDescriptionText"]',
        '.jobsearch-jobDescriptionText',
        '.jobsearch-JobComponent-description',
        '#jobDescription',
        '.job-description',
      ];
      
      let description = '';
      for (const sel of descSelectors) {
        const el = document.querySelector(sel);
        if (el?.textContent?.trim()) {
          description = el.textContent.trim();
          break;
        }
      }

      // Also extract additional metadata
      const salaryEl = document.querySelector('#salaryInfoAndJobType, .jobsearch-JobMetadataHeader-item');
      const salary = salaryEl?.textContent?.trim() || '';

      const companyEl = document.querySelector('[data-testid="inlineHeader-companyName"], .jobsearch-InlineCompanyRating-companyHeader');
      const company = companyEl?.textContent?.trim() || '';

      const locationEl = document.querySelector('[data-testid="inlineHeader-companyLocation"], .jobsearch-JobInfoHeader-subtitle');
      const location = locationEl?.textContent?.trim() || '';

      return { description, salary, company, location };
    });

    return jobData.description;
  } catch (e: any) {
    console.log(`[indeed] Error fetching job detail for ${jobKey}: ${e?.message}`);
    return "";
  }
}

/**
 * Login to Indeed account for better results and access.
 * Opens the login page and waits for user to complete login.
 */
export async function loginToIndeed(): Promise<boolean> {
  const ctx = await getScraperContext();
  const page = ctx.pages()[0] || await ctx.newPage();
  
  console.log("[indeed] Opening Indeed login page...");
  await page.goto("https://secure.indeed.com/auth", { waitUntil: "domcontentloaded" });
  
  // Check if already logged in
  const isLoggedIn = await page.evaluate(() => {
    return document.querySelector('[data-gnav-element-name="SignedInAccountMenu"]') !== null ||
           document.querySelector('.gnav-Account') !== null;
  });

  if (isLoggedIn) {
    console.log("[indeed] ✓ Already logged in!");
    return true;
  }

  console.log("[indeed] Please log in to your Indeed account in the browser window...");
  console.log("[indeed] Waiting up to 3 minutes for login...");

  try {
    await page.waitForFunction(() => {
      return document.querySelector('[data-gnav-element-name="SignedInAccountMenu"]') !== null ||
             document.querySelector('.gnav-Account') !== null ||
             window.location.href.includes('/jobs') ||
             window.location.href.includes('/myresume');
    }, { timeout: 180000 });
    
    console.log("[indeed] ✓ Login successful!");
    return true;
  } catch {
    console.log("[indeed] ✗ Login timeout - continuing without login");
    return false;
  }
}
