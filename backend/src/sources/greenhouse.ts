import * as cheerio from "cheerio";
import type { NormalizedJob } from "../types.js";

// Greenhouse public job board: https://boards-api.greenhouse.io/v1/boards/{company}/jobs?content=true
export async function fetchGreenhouse(companySlug: string): Promise<NormalizedJob[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(companySlug)}/jobs?content=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Greenhouse ${companySlug}: ${res.status}`);
  const data = (await res.json()) as { jobs: any[] };
  return (data.jobs ?? []).map((j) => {
    const desc = stripHtml(j.content ?? "");
    const loc: string | undefined = j.location?.name;
    return {
      source: "greenhouse",
      sourceJobId: String(j.id),
      url: j.absolute_url,
      company: companySlug,
      title: j.title,
      location: loc,
      remote: /remote/i.test(loc ?? ""),
      description: desc,
      postedAt: j.updated_at ? new Date(j.updated_at) : undefined,
    } satisfies NormalizedJob;
  });
}

function stripHtml(html: string): string {
  if (!html) return "";
  const decoded = html
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
  const $ = cheerio.load(decoded);
  return $.text().replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
