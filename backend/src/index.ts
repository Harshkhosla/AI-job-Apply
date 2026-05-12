import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
// Load .env from the repo root first (single source of truth), then fall back
// to backend/.env if present. Prisma CLI still uses backend/.env separately.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env") }); // doesn't override

import express from "express";
import cors from "cors";
import { prisma } from "./db.js";
import { ingest, ingestAll } from "./services/ingest.js";
import { getProfile, upsertProfile } from "./services/profile.js";
import {
  scoreJobById,
  tailorResumeForJob,
  generateOutreachForJob,
  scoreBatch,
} from "./services/actions.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ---------- Profile ----------
app.get("/api/profile", async (_req, res) => {
  const p = await getProfile();
  res.json(p);
});

app.put("/api/profile", async (req, res) => {
  try {
    await upsertProfile(req.body);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e?.message ?? String(e) });
  }
});

// ---------- Jobs ----------
app.get("/api/jobs", async (req, res) => {
  const {
    status,
    source,
    minScore,
    q,
    sort = "score",
    hours,
    page = "1",
    pageSize = "25",
    fit,
  } = req.query as Record<string, string>;
  const where: any = {};
  if (status) where.status = status;
  if (source) where.source = source;
  if (minScore) where.score = { gte: Number(minScore) };
  if (q) {
    where.OR = [
      { title: { contains: q } },
      { company: { contains: q } },
      { description: { contains: q } },
    ];
  }
  if (hours) {
    const since = new Date(Date.now() - Number(hours) * 60 * 60 * 1000);
    // If postedAt is known use it; otherwise fall back to when we fetched the job.
    where.AND = [
      ...(where.AND ?? []),
      {
        OR: [
          { postedAt: { gte: since } },
          { AND: [{ postedAt: null }, { fetchedAt: { gte: since } }] },
        ],
      },
    ];
  }

  // "Fit for me" — keyword pre-filter on title + drop senior/staff/principal roles
  // for an early-career profile. Tuned to Harsh's stack (MERN/Next.js/TS/AI).
  if (fit === "me") {
    const includes = [
      "full stack",
      "fullstack",
      "full-stack",
      "software engineer",
      "software developer",
      "software development engineer",
      "sde",
      "mern",
      "react",
      "next.js",
      "nextjs",
      "node",
      "typescript",
      "backend",
      "frontend",
      "ai engineer",
      "applied ai",
    ];
    const excludes = ["senior", "staff", "principal", "director", "manager", "lead", "head of", "vp", "intern"];
    where.AND = [
      ...(where.AND ?? []),
      { OR: includes.map((kw) => ({ title: { contains: kw } })) },
      ...excludes.map((kw) => ({ NOT: { title: { contains: kw } } })),
    ];
  }
  const orderBy =
    sort === "postedAt"
      ? [{ postedAt: "desc" as const }, { fetchedAt: "desc" as const }]
      : sort === "fetchedAt"
        ? [{ fetchedAt: "desc" as const }]
        : [{ score: { sort: "desc" as const, nulls: "last" as const } }, { fetchedAt: "desc" as const }];

  const pageNum = Math.max(1, Number(page));
  const size = Math.min(100, Math.max(1, Number(pageSize)));
  const skip = (pageNum - 1) * size;

  const [total, jobs] = await Promise.all([
    prisma.job.count({ where }),
    prisma.job.findMany({ where, orderBy, skip, take: size }),
  ]);
  res.json({ total, page: pageNum, pageSize: size, jobs });
});

app.get("/api/jobs/:id", async (req, res) => {
  const job = await prisma.job.findUnique({ where: { id: req.params.id } });
  if (!job) return res.status(404).json({ error: "not found" });
  res.json(job);
});

app.patch("/api/jobs/:id", async (req, res) => {
  const { status, notes } = req.body ?? {};
  const job = await prisma.job.update({
    where: { id: req.params.id },
    data: { status, notes },
  });
  res.json(job);
});

// Wipe scores so they can be regenerated with a newer rubric / updated profile.
app.post("/api/jobs/reset-scores", async (_req, res) => {
  const r = await prisma.job.updateMany({
    data: { score: null, scoreReason: null },
  });
  res.json({ cleared: r.count });
});

// ---------- Ingestion ----------
app.post("/api/ingest", async (req, res) => {
  try {
    const { source, query, location, pages } = req.body ?? {};
    if (!source || !query) return res.status(400).json({ error: "source and query required" });
    const result = await ingest({ source, query, location, pages });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});

// Bulk ingest across all curated companies (greenhouse + lever + ashby)
app.post("/api/ingest-all", async (req, res) => {
  try {
    const { hours, sources, concurrency } = req.body ?? {};
    const result = await ingestAll({
      hours: hours ? Number(hours) : undefined,
      sources,
      concurrency: concurrency ? Number(concurrency) : undefined,
    });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});

// ---------- Actions (LLM) ----------
app.post("/api/jobs/:id/score", async (req, res) => {
  try {
    const r = await scoreJobById(req.params.id);
    res.json(r);
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});

app.post("/api/jobs/:id/resume", async (req, res) => {
  try {
    const md = await tailorResumeForJob(req.params.id);
    res.json({ resume: md });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});

app.post("/api/jobs/:id/outreach", async (req, res) => {
  try {
    const out = await generateOutreachForJob(req.params.id, req.body?.recruiterName);
    res.json(out);
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});

app.post("/api/score-batch", async (req, res) => {
  try {
    const r = await scoreBatch(req.body ?? {});
    const scored = r.filter((x) => x.score != null).length;
    const failed = r.filter((x) => x.error).length;
    res.json({ scored, failed, results: r });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});

// ---------- Ingestion runs ----------
app.get("/api/runs", async (_req, res) => {
  const runs = await prisma.ingestionRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 50,
  });
  res.json(runs);
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`[backend] listening on http://localhost:${port}`);
});
