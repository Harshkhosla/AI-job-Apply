# AI Software Job Hunter

A personal AI-powered job agent that finds software jobs, scores them against your profile, tailors your resume per role, and drafts recruiter outreach — powered by **Claude**.

Stack: **TypeScript** monorepo · **Express** API · **React + Vite** dashboard · **Prisma + SQLite** · **Anthropic Claude** for LLM tasks.

---

## Features (MVP)

- **Ingestion** — pull jobs from Greenhouse, Lever, Ashby public boards, plus LinkedIn and Indeed scrapers.
- **Scoring** — Claude rates each job 0–100 with pros/cons against your profile.
- **Resume tailoring** — Claude rewrites your master resume for a specific job (truthful, never invents).
- **Recruiter outreach** — generates a concise subject + body you can copy/paste.
- **Dashboard** — filter, search, sort, and track status (new / shortlisted / applied / rejected / hidden).

Auto-apply is intentionally out of scope for the MVP (next phase).

---

## Project layout

```
JobsAutomation/
  backend/                   Express + Prisma + Claude
    prisma/schema.prisma
    src/
      index.ts               API entry
      db.ts                  Prisma client
      llm/claude.ts          Scoring, resume, outreach prompts
      sources/               One adapter per job source
      services/              ingest, profile, actions
      cli/ingest.ts          npm run ingest -- <source> <query> ...
      seed/                  profile.json + seed.ts
  frontend/                  React + Vite dashboard
    src/components/          JobsView, JobDetail, IngestView, ProfileView
```

---

## Setup

### 1. Install

```bash
cd JobsAutomation
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env`:
- `ANTHROPIC_API_KEY` — required, from https://console.anthropic.com
- `SCRAPER_API_KEY` *(optional)* — improves Indeed/LinkedIn reliability

The backend reads `.env` from the repo root (via `dotenv/config`). For convenience also copy it into `backend/.env` if you run scripts from there.

### 3. Initialize the database

```bash
npm run db:push       # creates backend/prisma/dev.db
npm run db:seed       # seeds an example profile — edit it via the Profile tab
```

### 4. Run

```bash
npm run dev
```

- Backend → http://localhost:4000
- Frontend → http://localhost:5173

---

## Typical workflow

1. Open **Profile** → paste your real resume info (JSON). Skills, experience, preferences, and an optional `baseResume` markdown.
2. Open **Ingest** → pull jobs:
   - `Greenhouse` + `stripe`
   - `Lever` + `netflix`
   - `Ashby` + `linear`
   - `LinkedIn` + `senior software engineer`, location `Remote`, 2 pages
3. Open **Jobs** → click **Score unscored** to have Claude rate them.
4. Sort by score, open the best ones, click **Tailor resume** and **Outreach**.
5. Mark statuses (shortlisted / applied) as you progress.

---

## CLI

```bash
# Ingest from the terminal
npm run ingest -- greenhouse stripe
npm run ingest -- lever netflix
npm run ingest -- ashby linear
npm run ingest -- linkedin "software engineer" "Remote" 2
npm run ingest -- indeed "backend engineer" "San Francisco" 1
```

---

## Notes & caveats

- **LinkedIn / Indeed scraping** — uses public endpoints. They rate-limit / block aggressively. Use sparingly, throttle, and consider a paid proxy (`SCRAPER_API_KEY`). Respect their ToS.
- **Greenhouse / Lever / Ashby** — these are *official public APIs* for job boards. Reliable.
- **LLM cost control** — scoring is single-shot per job and bounded to ~800 tokens. Use the **Score unscored** batch button (defaults to 15) to control burst.

---

## Roadmap (next phases)

- [ ] Email/Slack notifications for high-score new jobs
- [ ] Cron-based daily ingestion
- [ ] Auto-apply for ATS-friendly forms (Greenhouse/Lever/Ashby first)
- [ ] PDF export of tailored resume
- [ ] Vector search + dedupe across sources
- [ ] Recruiter contact enrichment

---

## Scripts reference

Root:
- `npm run dev` — backend + frontend
- `npm run db:push` / `db:seed`
- `npm run ingest -- ...`

Backend:
- `npm --workspace backend run dev` — tsx watch
- `npm --workspace backend run build` — tsc
- `npm --workspace backend run db:generate` — prisma generate

Frontend:
- `npm --workspace frontend run dev`
- `npm --workspace frontend run build`
