import * as cheerio from "cheerio";
import type { NormalizedJob } from "../types.js";

/**
 * LinkedIn guest job search scraper.
 * Uses the public guest API endpoint that returns HTML snippets.
 * NOTE: LinkedIn's ToS restricts scraping. Use responsibly, throttle, and
 * consider an official partner integration for production.
 */

// Parse LinkedIn's human-readable relative timestamps ("1 hour ago",
// "30 minutes ago", "2 days ago") into an absolute Date. LinkedIn's `<time
// datetime="…">` attribute on guest cards is date-only (`YYYY-MM-DD`), so
// for sub-day precision we have to read the visible text instead.
function parseRelativeTime(text: string): Date | undefined {
  if (!text) return undefined;
  const t = text.trim().toLowerCase();
  const m = t.match(/(\d+)\s*(minute|hour|day|week|month)s?\s*ago/);
  if (!m) {
    if (/just now|moments? ago/.test(t)) return new Date();
    return undefined;
  }
  const n = Number(m[1]);
  const unit = m[2];
  const ms =
    unit === "minute" ? n * 60_000 :
    unit === "hour"   ? n * 3_600_000 :
    unit === "day"    ? n * 86_400_000 :
    unit === "week"   ? n * 7 * 86_400_000 :
                        n * 30 * 86_400_000; // month
  return new Date(Date.now() - ms);
}

export async function fetchLinkedIn(
  keywords: string,
  location = "",
  pages = 1,
  withinHours?: number,
  easyApplyOnly = false
): Promise<NormalizedJob[]> {
  const jobs: NormalizedJob[] = [];
  // LinkedIn filters:
  //   f_TPR=r<seconds>  -> jobs posted within N seconds
  //   f_AL=true         -> Easy Apply only
  //   sortBy=DD         -> sort by date descending (newest first).
  //                       Without this LinkedIn returns relevance-sorted
  //                       results and freshly-posted jobs get buried.
  const tpr = withinHours ? `&f_TPR=r${Math.round(withinHours * 3600)}` : "";
  const easy = easyApplyOnly ? "&f_AL=true" : "";
  for (let page = 0; page < pages; page++) {
    const start = page * 25;
    const url =
      `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search` +
      `?keywords=${encodeURIComponent(keywords)}` +
      `&location=${encodeURIComponent(location)}` +
      `&start=${start}` +
      `&sortBy=DD` +
      tpr +
      easy;
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) {
      if (res.status === 429) break;
      throw new Error(`LinkedIn search ${res.status}`);
    }
    const html = await res.text();
    const $ = cheerio.load(html);
    const cards = $("li").toArray();
    for (const card of cards) {
      const $card = $(card);
      const link =
        $card.find("a.base-card__full-link").attr("href") ||
        $card.find("a").first().attr("href");
      const title = $card.find("h3.base-search-card__title").text().trim();
      const company = $card.find("h4.base-search-card__subtitle").text().trim();
      const loc = $card.find(".job-search-card__location").text().trim();
      const $time = $card.find("time");
      const dateTime = $time.attr("datetime");
      const relText = $time.text().trim(); // e.g. "1 hour ago", "30 minutes ago"
      const idMatch = link?.match(/-(\d+)\?/) || link?.match(/\/(\d+)$/);
      if (!link || !title || !company || !idMatch) continue;
      const id = idMatch[1];

      // Easy Apply detection. LinkedIn's guest search markup varies; we look
      // for a dedicated badge, a tracking attribute, or the literal text.
      const cardText = $card.text();
      const easyApply =
        easyApplyOnly ||
        $card.find(".job-search-card__easy-apply-label").length > 0 ||
        $card.find("[data-tracking-control-name*='easy']").length > 0 ||
        /\beasy apply\b/i.test(cardText);

      // Prefer the relative text ("1 hour ago") for fresh jobs because the
      // `datetime` attribute is date-only and rounds anything < 24h to
      // midnight. Fall back to the attribute for older postings.
      const relPosted = parseRelativeTime(relText);
      const attrPosted = dateTime ? new Date(dateTime) : undefined;
      const postedAt =
        relPosted ??
        (attrPosted && !Number.isNaN(attrPosted.getTime()) ? attrPosted : undefined);

      jobs.push({
        source: "linkedin",
        sourceJobId: id,
        url: link.split("?")[0],
        company,
        title,
        location: loc,
        remote: /remote/i.test(loc),
        easyApply,
        description: "",
        postedAt,
      });
    }
    // gentle throttle between pages
    await new Promise((r) => setTimeout(r, 800));
  }
  return jobs;
}

export async function fetchLinkedInJobDetail(jobId: string): Promise<string> {
  const url = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${jobId}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    },
  });
  if (!res.ok) return "";
  const html = await res.text();
  const $ = cheerio.load(html);
  const desc = $(".description__text, .show-more-less-html__markup").text();
  return desc.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
