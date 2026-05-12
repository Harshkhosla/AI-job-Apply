import * as cheerio from "cheerio";
import type { NormalizedJob } from "../types.js";

/**
 * Indeed scraper. Indeed actively blocks bots, so this works best with a
 * SCRAPER_API_KEY (https://www.scraperapi.com) or a residential proxy.
 * Without one, expect frequent 403s.
 */
export async function fetchIndeed(
  query: string,
  location = "",
  pages = 1,
  withinHours?: number
): Promise<NormalizedJob[]> {
  const jobs: NormalizedJob[] = [];
  // Indeed supports a "days ago" filter: fromage=N (rounded up from hours)
  const fromage = withinHours ? `&fromage=${Math.max(1, Math.ceil(withinHours / 24))}` : "";
  for (let page = 0; page < pages; page++) {
    const start = page * 10;
    const indeedUrl =
      `https://www.indeed.com/jobs?q=${encodeURIComponent(query)}` +
      `&l=${encodeURIComponent(location)}&start=${start}${fromage}`;
    const fetchUrl = process.env.SCRAPER_API_KEY
      ? `https://api.scraperapi.com/?api_key=${process.env.SCRAPER_API_KEY}&url=${encodeURIComponent(indeedUrl)}`
      : indeedUrl;

    const res = await fetch(fetchUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
    });
    if (!res.ok) {
      if (res.status === 403 || res.status === 429) break;
      throw new Error(`Indeed ${res.status}`);
    }
    const html = await res.text();
    const $ = cheerio.load(html);
    const cards = $("a.tapItem, a.result, div.job_seen_beacon").toArray();
    for (const card of cards) {
      const $card = $(card);
      const title = $card.find("h2.jobTitle span").first().text().trim();
      const company = $card.find('[data-testid="company-name"]').text().trim();
      const loc = $card.find('[data-testid="text-location"]').text().trim();
      const jk = $card.attr("data-jk") || $card.find("[data-jk]").attr("data-jk");
      if (!title || !jk) continue;
      jobs.push({
        source: "indeed",
        sourceJobId: jk,
        url: `https://www.indeed.com/viewjob?jk=${jk}`,
        company: company || "Unknown",
        title,
        location: loc,
        remote: /remote/i.test(loc),
        description: "",
      });
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  return jobs;
}
