import type { NormalizedJob } from "../types.js";

// Ashby public board: https://api.ashbyhq.com/posting-api/job-board/{org}?includeCompensation=true
export async function fetchAshby(orgSlug: string): Promise<NormalizedJob[]> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(orgSlug)}?includeCompensation=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Ashby ${orgSlug}: ${res.status}`);
  const data = (await res.json()) as { jobs?: any[] };
  return (data.jobs ?? []).map((j) => {
    const desc = (j.descriptionPlain ?? j.description ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return {
      source: "ashby",
      sourceJobId: String(j.id),
      url: j.jobUrl ?? j.applyUrl,
      company: orgSlug,
      title: j.title,
      location: j.location,
      remote: !!j.isRemote,
      employmentType: j.employmentType,
      description: desc,
      postedAt: j.publishedAt ? new Date(j.publishedAt) : undefined,
    } satisfies NormalizedJob;
  });
}
