import { prisma } from "../db.js";
import { parseForm } from "../apply/parsers/index.js";
import { buildFieldPlan } from "../apply/fieldMapper.js";
import { getProfile } from "./profile.js";
import { generateCoverLetter } from "../llm/claude.js";
import {
  openLinkedInJob,
  fillLinkedInForm,
  closeBrowser,
} from "../apply/playwright/linkedin.js";
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
  };
}

/**
 * Build (or rebuild) an Application draft for a given job:
 *   1. fetch the form schema from the ATS
 *   2. map each field with heuristics + Claude
 *   3. optionally generate a cover letter
 * Result is stored on the Application row and returned.
 */
// Throttle for LinkedIn: ensure at least N seconds between plans.
let _lastLinkedInPlanAt = 0;
const LINKEDIN_THROTTLE_MS = 60_000;

export async function planApplication(
  jobId: string,
  opts: { withCoverLetter?: boolean; waitForThrottle?: boolean } = {}
) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("Job not found");
  const profile = await getProfile();
  if (!profile) throw new Error("Profile not set");
  if (!["greenhouse", "lever", "ashby", "linkedin"].includes(job.source)) {
    throw new Error(`Auto-apply is not supported for ${job.source} yet.`);
  }

  // Enforce daily cap + throttle for LinkedIn specifically (highest ban risk).
  if (job.source === "linkedin") {
    const s = await getOrCreateSettings();
    if (s.appliedToday >= s.dailyCap) {
      throw new Error(
        `Daily cap reached (${s.appliedToday}/${s.dailyCap}). Raise the cap in Settings or wait until tomorrow.`
      );
    }
    const wait = LINKEDIN_THROTTLE_MS - (Date.now() - _lastLinkedInPlanAt);
    if (wait > 0) {
      if (opts.waitForThrottle) {
        console.log(`[linkedin] throttle: sleeping ${Math.ceil(wait / 1000)}s before next plan`);
        await new Promise((r) => setTimeout(r, wait));
      } else {
        throw new Error(
          `Slow down — please wait ${Math.ceil(wait / 1000)}s before planning another LinkedIn application.`
        );
      }
    }
    _lastLinkedInPlanAt = Date.now();
  }

  // We need the application row early for LinkedIn so the Playwright session
  // can be keyed by applicationId. Create/upsert a stub draft first.
  const existingDraft = await prisma.application.findFirst({
    where: { jobId, status: { in: ["draft", "preview"] } },
    orderBy: { createdAt: "desc" },
  });
  const draft =
    existingDraft ??
    (await prisma.application.create({ data: { jobId, status: "draft" } }));

  const form =
    job.source === "linkedin"
      ? await openLinkedInJob(job.url, draft.id)
      : await parseForm(job.source, job.url);
  const plan = await buildFieldPlan(form, profile, {
    jobTitle: job.title,
    jobCompany: job.company,
    jobDescription: job.description ?? "",
  });

  let coverLetter: string | null = null;
  const formNeedsCover = form.fields.some((f) =>
    /cover letter|why .* (interested|apply|join)|tell us about/i.test(f.label)
  );
  if (opts.withCoverLetter || formNeedsCover) {
    try {
      coverLetter = await generateCoverLetter(profile, toNormalized(job));
    } catch (e: any) {
      plan.warnings.push(`Cover letter generation failed: ${e?.message ?? e}`);
    }
  }

  // Update the draft row we created above with the parsed form + plan.
  const data = {
    status: "preview" as const,
    formSchema: JSON.stringify(form),
    fieldPlan: JSON.stringify(plan),
    coverLetter,
    resumeUsed: profile.resumeFileUrl ?? null,
    dryRun: true,
  };
  return prisma.application.update({ where: { id: draft.id }, data });
}

/**
 * Push the current field-plan values into the live LinkedIn modal so the user
 * can review and click "Submit application" themselves.
 * No-op (and throws) for non-LinkedIn sources.
 */
export async function fillLinkedInApplication(applicationId: string) {
  const app = await prisma.application.findUnique({
    where: { id: applicationId },
    include: { job: true },
  });
  if (!app) throw new Error("Application not found");
  if (app.job.source !== "linkedin") {
    throw new Error("Browser-fill is only supported for LinkedIn jobs.");
  }
  if (!app.fieldPlan) throw new Error("Plan the application first.");
  const plan = JSON.parse(app.fieldPlan);
  const profile = await getProfile();
  const result = await fillLinkedInForm(
    applicationId,
    plan.fields,
    profile ?? undefined,
    profile
      ? {
          jobTitle: app.job.title,
          jobCompany: app.job.company,
          jobDescription: app.job.description ?? "",
        }
      : undefined
  );
  return result;
}

export async function closeLinkedInBrowser() {
  await closeBrowser();
}

export async function getApplicationByJob(jobId: string) {
  return prisma.application.findFirst({
    where: { jobId },
    orderBy: { createdAt: "desc" },
  });
}

export async function listApplications(filter: { status?: string } = {}) {
  return prisma.application.findMany({
    where: { ...(filter.status ? { status: filter.status } : {}) },
    orderBy: { updatedAt: "desc" },
    include: { job: true },
    take: 200,
  });
}

/**
 * Apply a single field override (user manually edits a value before submitting).
 */
export async function updateFieldValue(applicationId: string, fieldId: string, value: any) {
  const app = await prisma.application.findUnique({ where: { id: applicationId } });
  if (!app || !app.fieldPlan) throw new Error("Application not found");
  const plan = JSON.parse(app.fieldPlan);
  const f = plan.fields.find((x: any) => x.id === fieldId);
  if (!f) throw new Error("Field not in plan");
  f.value = value;
  f.source = "default"; // user override
  f.confidence = 1;
  // Recompute unresolved
  plan.unresolved = plan.fields.filter(
    (p: any) =>
      p.required &&
      (p.value === null || p.value === undefined || p.value === "" || p.confidence < 0.6)
  );
  return prisma.application.update({
    where: { id: applicationId },
    data: { fieldPlan: JSON.stringify(plan) },
  });
}

export async function getOrCreateSettings() {
  let s = await prisma.autoApplySettings.findFirst();
  if (!s) s = await prisma.autoApplySettings.create({ data: {} });
  // Reset the daily counter if a new day rolled over.
  const today = new Date().toISOString().slice(0, 10);
  const last = s.lastCounterReset.toISOString().slice(0, 10);
  if (last !== today) {
    s = await prisma.autoApplySettings.update({
      where: { id: s.id },
      data: { appliedToday: 0, lastCounterReset: new Date() },
    });
  }
  return s;
}

export async function updateSettings(patch: any) {
  const s = await getOrCreateSettings();
  return prisma.autoApplySettings.update({
    where: { id: s.id },
    data: patch,
  });
}
