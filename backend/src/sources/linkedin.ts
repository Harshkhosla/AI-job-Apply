import * as cheerio from "cheerio";
import type { NormalizedJob } from "../types.js";

/**
 * LinkedIn guest job search scraper.
 * Uses the public guest API endpoint that returns HTML snippets.
 * NOTE: LinkedIn's ToS restricts scraping. Use responsibly, throttle, and
 * consider an official partner integration for production.
 */
export async function fetchLinkedIn(
  keywords: string,
  location = "",
  pages = 1,
  withinHours?: number
): Promise<NormalizedJob[]> {
  const jobs: NormalizedJob[] = [];
  // LinkedIn supports a "time posted" filter: f_TPR=r<seconds>
  const tpr = withinHours ? `&f_TPR=r${Math.round(withinHours * 3600)}` : "";
  for (let page = 0; page < pages; page++) {
    const start = page * 25;
    const url =
      `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search` +
      `?keywords=${encodeURIComponent(keywords)}` +
      `&location=${encodeURIComponent(location)}` +
      `&start=${start}` +
      tpr;
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
      const dateTime = $card.find("time").attr("datetime");
      const idMatch = link?.match(/-(\d+)\?/) || link?.match(/\/(\d+)$/);
      if (!link || !title || !company || !idMatch) continue;
      const id = idMatch[1];
      // Description fetched lazily — keep stub here
      jobs.push({
        source: "linkedin",
        sourceJobId: id,
        url: link.split("?")[0],
        company,
        title,
        location: loc,
        remote: /remote/i.test(loc),
        description: "",
        postedAt: dateTime ? new Date(dateTime) : undefined,
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
