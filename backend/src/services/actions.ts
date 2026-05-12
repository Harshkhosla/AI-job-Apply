import { prisma } from "../db.js";
import { getProfile } from "./profile.js";
import { scoreJob, tailorResume, generateOutreach } from "../llm/claude.js";
import type { NormalizedJob } from "../types.js";

function toNormalized(j: any): NormalizedJob {
  return {
    source: j.source,
    sourceJobId: j.sourceJobId,
    url: j.url,
    company: j.company,
    title: j.title,
    location: j.location ?? undefined,
    remote: j.remote ?? false,
    employmentType: j.employmentType ?? undefined,
    description: j.description ?? "",
    salaryMin: j.salaryMin ?? undefined,
    salaryMax: j.salaryMax ?? undefined,
    currency: j.currency ?? undefined,
    postedAt: j.postedAt ?? undefined,
  };
}

export async function scoreJobById(jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  const profile = await getProfile();
  if (!job || !profile) throw new Error("Job or profile not found");
  const result = await scoreJob(profile, toNormalized(job));
  await prisma.job.update({
    where: { id: jobId },
    data: { score: result.score, scoreReason: JSON.stringify(result) },
  });
  return result;
}

export async function tailorResumeForJob(jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  const profile = await getProfile();
  if (!job || !profile) throw new Error("Job or profile not found");
  const md = await tailorResume(profile, toNormalized(job));
  await prisma.job.update({ where: { id: jobId }, data: { tailoredResume: md } });
  return md;
}

export async function generateOutreachForJob(jobId: string, recruiterName?: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  const profile = await getProfile();
  if (!job || !profile) throw new Error("Job or profile not found");
  const out = await generateOutreach(profile, toNormalized(job), recruiterName);
  await prisma.job.update({ where: { id: jobId }, data: { outreach: JSON.stringify(out) } });
  return out;
}

export interface ScoreBatchFilter {
  limit?: number;
  status?: string;
  source?: string;
  q?: string;
  hours?: number;
  onlyUnscored?: boolean;
  ids?: string[]; // explicit set wins over filters
}

export async function scoreBatch(filter: ScoreBatchFilter = {}) {
  let jobs;
  if (filter.ids && filter.ids.length > 0) {
    jobs = await prisma.job.findMany({ where: { id: { in: filter.ids } } });
  } else {
    const where: any = { status: { not: "hidden" } };
    if (filter.onlyUnscored !== false) where.score = null;
    if (filter.status) where.status = filter.status;
    if (filter.source) where.source = filter.source;
    if (filter.q) {
      where.OR = [
        { title: { contains: filter.q } },
        { company: { contains: filter.q } },
        { description: { contains: filter.q } },
      ];
    }
    if (filter.hours) {
      const since = new Date(Date.now() - filter.hours * 60 * 60 * 1000);
      where.AND = [
        {
          OR: [
            { postedAt: { gte: since } },
            { AND: [{ postedAt: null }, { fetchedAt: { gte: since } }] },
          ],
        },
      ];
    }
    jobs = await prisma.job.findMany({
      where,
      take: Math.min(50, filter.limit ?? 15),
      orderBy: { fetchedAt: "desc" },
    });
  }

  const results: Array<{ id: string; score?: number; error?: string }> = [];
  for (const job of jobs) {
    try {
      const r = await scoreJobById(job.id);
      results.push({ id: job.id, score: r.score });
    } catch (e: any) {
      results.push({ id: job.id, error: e?.message ?? String(e) });
    }
  }
  return results;
}

// Back-compat
export const scoreAllUnscored = (limit = 20) => scoreBatch({ limit, onlyUnscored: true });
