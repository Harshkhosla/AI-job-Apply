import { prisma } from "../db.js";
import type { NormalizedJob, JobSource } from "../types.js";
import { fetchGreenhouse } from "../sources/greenhouse.js";
import { fetchLever } from "../sources/lever.js";
import { fetchAshby } from "../sources/ashby.js";
import { fetchLinkedIn, fetchLinkedInJobDetail } from "../sources/linkedin.js";
import { fetchIndeed } from "../sources/indeed.js";
import {
  GREENHOUSE_COMPANIES,
  LEVER_COMPANIES,
  ASHBY_COMPANIES,
  LINKEDIN_SEARCHES,
  INDEED_SEARCHES,
  type KeywordSearch,
} from "../sources/companies.js";

export interface IngestRequest {
  source: JobSource;
  // Greenhouse/Lever/Ashby: company slug
  // LinkedIn/Indeed: keyword search
  query: string;
  location?: string;
  pages?: number;
  withinHours?: number;
}

export async function ingest(req: IngestRequest): Promise<{ inserted: number; total: number }> {
  const run = await prisma.ingestionRun.create({
    data: { source: req.source, query: `${req.query}${req.location ? " @" + req.location : ""}` },
  });
  try {
    let jobs: NormalizedJob[] = [];
    switch (req.source) {
      case "greenhouse":
        jobs = await fetchGreenhouse(req.query);
        break;
      case "lever":
        jobs = await fetchLever(req.query);
        break;
      case "ashby":
        jobs = await fetchAshby(req.query);
        break;
      case "linkedin":
        jobs = await fetchLinkedIn(
          req.query,
          req.location ?? "",
          req.pages ?? 1,
          req.withinHours
        );
        // hydrate descriptions (best-effort)
        for (const j of jobs) {
          if (!j.description) {
            try {
              j.description = await fetchLinkedInJobDetail(j.sourceJobId);
              await new Promise((r) => setTimeout(r, 600));
            } catch {
              // ignore
            }
          }
        }
        break;
      case "indeed":
        jobs = await fetchIndeed(
          req.query,
          req.location ?? "",
          req.pages ?? 1,
          req.withinHours
        );
        break;
    }

    let inserted = 0;
    for (const j of jobs) {
      try {
        await prisma.job.upsert({
          where: { source_sourceJobId: { source: j.source, sourceJobId: j.sourceJobId } },
          create: {
            source: j.source,
            sourceJobId: j.sourceJobId,
            url: j.url,
            company: j.company,
            title: j.title,
            location: j.location,
            remote: j.remote ?? false,
            employmentType: j.employmentType,
            description: j.description,
            salaryMin: j.salaryMin,
            salaryMax: j.salaryMax,
            currency: j.currency,
            postedAt: j.postedAt,
          },
          update: {
            description: j.description || undefined,
            location: j.location,
            url: j.url,
          },
        });
        inserted++;
      } catch (e) {
        // skip on conflict / validation error
      }
    }

    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: { count: inserted, finishedAt: new Date() },
    });
    return { inserted, total: jobs.length };
  } catch (e: any) {
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: { error: e?.message ?? String(e), finishedAt: new Date() },
    });
    throw e;
  }
}

export interface IngestAllOptions {
  sources?: Array<JobSource>;
  // Only keep jobs whose postedAt falls within the last N hours.
  // If a job has no postedAt, it's kept (we can't filter what we don't know).
  hours?: number;
  concurrency?: number;
}

export interface IngestAllResult {
  totalCompanies: number;
  totalJobs: number;
  inserted: number;
  kept: number;
  errors: Array<{ source: string; company: string; error: string }>;
}

/**
 * Fetches jobs from every company in the curated lists across the chosen ATS
 * providers, optionally filtering to jobs posted in the last `hours` hours.
 */
export async function ingestAll(opts: IngestAllOptions = {}): Promise<IngestAllResult> {
  const sources = opts.sources ?? ["greenhouse", "lever", "ashby", "linkedin", "indeed"];
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const cutoff = opts.hours ? new Date(Date.now() - opts.hours * 60 * 60 * 1000) : null;

  type Task =
    | { kind: "board"; source: "greenhouse" | "lever" | "ashby"; company: string }
    | { kind: "search"; source: "linkedin" | "indeed"; search: KeywordSearch };
  const tasks: Task[] = [];
  if (sources.includes("greenhouse"))
    GREENHOUSE_COMPANIES.forEach((c) =>
      tasks.push({ kind: "board", source: "greenhouse", company: c })
    );
  if (sources.includes("lever"))
    LEVER_COMPANIES.forEach((c) =>
      tasks.push({ kind: "board", source: "lever", company: c })
    );
  if (sources.includes("ashby"))
    ASHBY_COMPANIES.forEach((c) =>
      tasks.push({ kind: "board", source: "ashby", company: c })
    );
  if (sources.includes("linkedin"))
    LINKEDIN_SEARCHES.forEach((s) =>
      tasks.push({ kind: "search", source: "linkedin", search: s })
    );
  if (sources.includes("indeed"))
    INDEED_SEARCHES.forEach((s) =>
      tasks.push({ kind: "search", source: "indeed", search: s })
    );

  const result: IngestAllResult = {
    totalCompanies: tasks.length,
    totalJobs: 0,
    inserted: 0,
    kept: 0,
    errors: [],
  };

  const run = await prisma.ingestionRun.create({
    data: {
      source: sources.join("+"),
      query: `bulk:${tasks.length} companies${cutoff ? ` last ${opts.hours}h` : ""}`,
    },
  });

  // Simple worker pool
  let cursor = 0;
  async function worker() {
    while (cursor < tasks.length) {
      const idx = cursor++;
      const task = tasks[idx];
      const label =
        task.kind === "board" ? task.company : `${task.search.query}@${task.search.location ?? ""}`;
      try {
        let jobs: NormalizedJob[] = [];
        if (task.kind === "board") {
          if (task.source === "greenhouse") jobs = await fetchGreenhouse(task.company);
          else if (task.source === "lever") jobs = await fetchLever(task.company);
          else if (task.source === "ashby") jobs = await fetchAshby(task.company);
        } else if (task.source === "linkedin") {
          jobs = await fetchLinkedIn(
            task.search.query,
            task.search.location ?? "",
            task.search.pages ?? 1,
            opts.hours
          );
          // Best-effort: hydrate first ~10 descriptions to keep total request count modest
          for (const j of jobs.slice(0, 10)) {
            if (!j.description) {
              try {
                j.description = await fetchLinkedInJobDetail(j.sourceJobId);
                await new Promise((r) => setTimeout(r, 500));
              } catch {
                // ignore
              }
            }
          }
        } else if (task.source === "indeed") {
          jobs = await fetchIndeed(
            task.search.query,
            task.search.location ?? "",
            task.search.pages ?? 1,
            opts.hours
          );
        }

        result.totalJobs += jobs.length;

        const kept = cutoff
          ? jobs.filter((j) => !j.postedAt || j.postedAt >= cutoff)
          : jobs;
        result.kept += kept.length;

        for (const j of kept) {
          try {
            await prisma.job.upsert({
              where: { source_sourceJobId: { source: j.source, sourceJobId: j.sourceJobId } },
              create: {
                source: j.source,
                sourceJobId: j.sourceJobId,
                url: j.url,
                company: j.company,
                title: j.title,
                location: j.location,
                remote: j.remote ?? false,
                employmentType: j.employmentType,
                description: j.description,
                salaryMin: j.salaryMin,
                salaryMax: j.salaryMax,
                currency: j.currency,
                postedAt: j.postedAt,
              },
              update: {
                description: j.description || undefined,
                location: j.location,
                url: j.url,
                postedAt: j.postedAt,
              },
            });
            result.inserted++;
          } catch {
            // skip individual job errors
          }
        }
      } catch (e: any) {
        result.errors.push({
          source: task.source,
          company: label,
          error: e?.message ?? String(e),
        });
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));

  await prisma.ingestionRun.update({
    where: { id: run.id },
    data: {
      count: result.inserted,
      finishedAt: new Date(),
      error: result.errors.length
        ? `${result.errors.length} company errors`
        : null,
    },
  });

  return result;
}
