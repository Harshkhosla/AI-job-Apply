import type { NormalizedJob } from "../types.js";

// Lever public postings API: https://api.lever.co/v0/postings/{company}?mode=json
export async function fetchLever(companySlug: string): Promise<NormalizedJob[]> {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(companySlug)}?mode=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Lever ${companySlug}: ${res.status}`);
  const data = (await res.json()) as any[];
  return data.map((j) => {
    const desc = [j.descriptionPlain, ...(j.lists ?? []).map((l: any) => `${l.text}\n${stripHtml(l.content)}`)]
      .filter(Boolean)
      .join("\n\n");
    const loc = j.categories?.location;
    return {
      source: "lever",
      sourceJobId: String(j.id),
      url: j.hostedUrl,
      company: companySlug,
      title: j.text,
      location: loc,
      remote: /remote/i.test(loc ?? ""),
      employmentType: j.categories?.commitment,
      description: desc,
      postedAt: j.createdAt ? new Date(j.createdAt) : undefined,
    } satisfies NormalizedJob;
  });
}

function stripHtml(html: string): string {
  if (!html) return "";
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
