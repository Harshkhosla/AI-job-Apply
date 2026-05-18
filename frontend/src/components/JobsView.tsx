import { useEffect, useState } from "react";
import { api, type Job } from "../api";
import JobDetail from "./JobDetail";
import BatchApplyModal from "./BatchApplyModal";

interface JobsViewProps {
  preset?: { source?: string; hours?: string; q?: string };
}

export default function JobsView({ preset }: JobsViewProps = {}) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  // Default to 10 jobs per page so the "Select page" button picks the
  // batch-apply maximum in one click.
  const [pageSize, setPageSize] = useState(10);
  const [selected, setSelected] = useState<Job | null>(null);
  // LinkedIn-only mode: `source` pinned to "linkedin", default sort flipped
  // to `postedAt` so "latest first" is the natural ordering.
  const [filters, setFilters] = useState({
    status: "",
    source: "linkedin",
    minScore: "",
    q: preset?.q ?? "",
    sort: "postedAt",
    hours: preset?.hours ?? "",
    fit: "",
    easyApply: "",
  });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchModal, setBatchModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [scoring, setScoring] = useState<null | { done: number; total: number; failed: number }>(null);

  async function load(targetPage = page) {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: String(targetPage), pageSize: String(pageSize) };
      for (const [k, v] of Object.entries(filters)) if (v) params[k] = v;
      const data = await api.listJobs(params);
      setJobs(data.jobs);
      setTotal(data.total);
      setPage(data.page);
      if (selected) {
        const updated = data.jobs.find((j) => j.id === selected.id);
        if (updated) setSelected(updated);
      }
    } finally {
      setLoading(false);
    }
  }

  // Reset to page 1 whenever filters or page size change
  useEffect(() => {
    setPage(1);
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, pageSize]);

  // If a fresh preset is passed in, apply it.
  // LinkedIn-only mode: `source` stays pinned regardless of preset.
  useEffect(() => {
    if (!preset) return;
    setFilters((prev) => ({
      ...prev,
      source: "linkedin",
      hours: preset.hours ?? "",
      q: preset.q ?? "",
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset?.source, preset?.hours, preset?.q]);

  // Score each job on the *current page* sequentially so you get progress feedback.
  async function scoreCurrentPage(onlyUnscored: boolean) {
    const targets = onlyUnscored ? jobs.filter((j) => j.score == null) : jobs;
    if (targets.length === 0) return;
    setScoring({ done: 0, total: targets.length, failed: 0 });
    let done = 0;
    let failed = 0;
    for (const job of targets) {
      try {
        await api.score(job.id);
      } catch {
        failed++;
      }
      done++;
      setScoring({ done, total: targets.length, failed });
      if (done % 3 === 0) await load(page);
    }
    setScoring(null);
    await load(page);
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const unscoredOnPage = jobs.filter((j) => j.score == null).length;
  // Kept around for the (currently commented) bulk-scoring buttons. Touch
  // these so TS/ESLint don't flag them as unused in LinkedIn-only mode.
  void unscoredOnPage;
  void scoreCurrentPage;

  return (
    <>
      <div className="toolbar">
        <input
          placeholder="Search title / company / desc…"
          value={filters.q}
          onChange={(e) => setFilters({ ...filters, q: e.target.value })}
          style={{ minWidth: 220 }}
        />
        {/*
        LinkedIn-only mode: status / source / min-score filters hidden.
        Re-enable by uncommenting and removing the pinned `source` in the
        initial filters state above.

        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">Active (default)</option>
          <option value="new">New</option>
          <option value="shortlisted">Shortlisted</option>
          <option value="applied">Applied</option>
          <option value="rejected">Rejected</option>
          <option value="hidden">Hidden</option>
        </select>
        <select value={filters.source} onChange={(e) => setFilters({ ...filters, source: e.target.value })}>
          <option value="">All sources</option>
          <option value="greenhouse">Greenhouse</option>
          <option value="lever">Lever</option>
          <option value="ashby">Ashby</option>
          <option value="linkedin">LinkedIn</option>
          <option value="indeed">Indeed</option>
        </select>
        <select value={filters.minScore} onChange={(e) => setFilters({ ...filters, minScore: e.target.value })}>
          <option value="">Any score</option>
          <option value="60">≥ 60</option>
          <option value="75">≥ 75</option>
          <option value="85">≥ 85</option>
        </select>
        */}
        <button
          className={filters.fit ? "primary" : ""}
          onClick={() => setFilters({ ...filters, fit: filters.fit ? "" : "me" })}
          title="Show only roles matching your stack and seniority"
        >
          {filters.fit ? "✓ Best for me" : "Best for me"}
        </button>
        <button
          className={filters.easyApply ? "primary" : ""}
          onClick={() =>
            setFilters({ ...filters, easyApply: filters.easyApply ? "" : "1" })
          }
          title="Only LinkedIn jobs with Easy Apply"
        >
          {filters.easyApply ? "✓ Easy Apply only" : "Easy Apply only"}
        </button>
        <select value={filters.hours} onChange={(e) => setFilters({ ...filters, hours: e.target.value })}>
          <option value="">Any time (≤5d)</option>
          <option value="24">Last 24h</option>
          <option value="48">Last 48h</option>
          <option value="72">Last 3d</option>
          <option value="120">Last 5d</option>
        </select>
        <select value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value })}>
          <option value="score">Sort: Score</option>
          <option value="postedAt">Sort: Posted</option>
          <option value="fetchedAt">Sort: Fetched</option>
        </select>
        <button onClick={() => load(page)} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
        {/*
        LinkedIn-only mode: bulk scoring controls hidden. The per-job
        `Score` button inside JobDetail is still available.

        <button
          className="primary"
          onClick={() => scoreCurrentPage(true)}
          disabled={!!scoring || unscoredOnPage === 0}
          title="Score unscored jobs on this page"
        >
          {scoring
            ? `Scoring ${scoring.done}/${scoring.total}${scoring.failed ? ` (${scoring.failed} failed)` : ""}…`
            : `Score page (${unscoredOnPage} unscored)`}
        </button>
        <button onClick={() => scoreCurrentPage(false)} disabled={!!scoring || jobs.length === 0}>
          Re-score page
        </button>
        <button
          onClick={async () => {
            if (!confirm("Clear all scores? You'll need to re-score jobs after this.")) return;
            const r = await api.resetScores();
            alert(`Cleared scores on ${r.cleared} jobs.`);
            await load(page);
          }}
          disabled={!!scoring}
          title="Wipe all existing scores (after profile / preferences update)"
        >
          Clear scores
        </button>
        */}
        <select
          value={String(pageSize)}
          onChange={(e) => setPageSize(Number(e.target.value))}
          title="Jobs per page"
        >
          <option value="10">10 / page</option>
          <option value="25">25 / page</option>
          <option value="50">50 / page</option>
        </select>
        <button
          onClick={() => {
            // Select up to 10 visible jobs (batch-apply cap).
            setSelectedIds((prev) => {
              const merged = [...prev];
              for (const j of jobs) {
                if (merged.length >= 10) break;
                if (!merged.includes(j.id)) merged.push(j.id);
              }
              return merged;
            });
          }}
          disabled={jobs.length === 0 || selectedIds.length >= 10}
          title="Select up to 10 jobs from this page for batch apply"
        >
          Select page ({Math.min(10, jobs.length)})
        </button>
        <button
          onClick={() => setSelectedIds([])}
          disabled={selectedIds.length === 0}
          title="Clear current selection"
        >
          Clear
        </button>
        <button
          className="primary"
          onClick={() => setBatchModal(true)}
          disabled={selectedIds.length === 0}
          title="Auto-apply to the selected jobs sequentially"
        >
          Batch Apply ({selectedIds.length})
        </button>
        <span style={{ color: "var(--muted)", fontSize: 12, marginLeft: "auto" }}>
          {total} jobs · page {page}/{totalPages}
        </span>
      </div>

      <div className="content">
        <div className="jobs-grid">
          <div className="job-list">
            {jobs.length === 0 ? (
              <div className="empty">No jobs. Try the Ingest tab.</div>
            ) : (
              jobs.map((j) => (
                <JobRow
                  key={j.id}
                  job={j}
                  selected={selected?.id === j.id}
                  onClick={() => setSelected(j)}
                  checked={selectedIds.includes(j.id)}
                  onToggleSelect={(checked) => {
                    setSelectedIds((prev) => {
                      if (checked) {
                        if (prev.length >= 10) {
                          alert("Maximum 10 jobs per batch.");
                          return prev;
                        }
                        return prev.includes(j.id) ? prev : [...prev, j.id];
                      }
                      return prev.filter((x) => x !== j.id);
                    });
                  }}
                />
              ))
            )}
            <div
              style={{
                display: "flex",
                gap: 8,
                padding: 12,
                justifyContent: "center",
                borderTop: "1px solid var(--border)",
                background: "var(--panel)",
                position: "sticky",
                bottom: 0,
              }}
            >
              <button onClick={() => load(1)} disabled={page <= 1 || loading}>« First</button>
              <button onClick={() => load(page - 1)} disabled={page <= 1 || loading}>‹ Prev</button>
              <span style={{ alignSelf: "center", fontSize: 12, color: "var(--muted)" }}>
                {page} / {totalPages}
              </span>
              <button onClick={() => load(page + 1)} disabled={page >= totalPages || loading}>Next ›</button>
              <button onClick={() => load(totalPages)} disabled={page >= totalPages || loading}>Last »</button>
            </div>
          </div>
          <div className="job-detail">
            {selected ? (
              <JobDetail job={selected} onChange={() => load(page)} />
            ) : (
              <div className="empty">Select a job to view details.</div>
            )}
          </div>
        </div>
      </div>
      {batchModal && (
        <BatchApplyModal
          jobs={jobs.filter((j) => selectedIds.includes(j.id))}
          onClose={() => {
            setBatchModal(false);
            setSelectedIds([]);
            load(page);
          }}
        />
      )}
    </>
  );
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diffMs = Date.now() - then;
  if (diffMs < 0) return "just now";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function JobRow({
  job,
  selected,
  onClick,
  checked,
  onToggleSelect,
}: {
  job: Job;
  selected: boolean;
  onClick: () => void;
  checked: boolean;
  onToggleSelect: (checked: boolean) => void;
}) {
  const scoreClass =
    job.score == null ? "" : job.score >= 80 ? "score-high" : job.score >= 60 ? "score-mid" : "score-low";
  // Prefer the real posted date; fall back to when we fetched it.
  const ageSource = job.postedAt ?? job.fetchedAt;
  const age = timeAgo(ageSource);
  const isFallback = !job.postedAt;
  return (
    <div className={`job-row ${selected ? "selected" : ""}`} onClick={onClick}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <input
          type="checkbox"
          checked={checked}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onToggleSelect(e.target.checked)}
          title="Select for batch apply"
          style={{ marginTop: 4 }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="title">
            {job.title}
            {job.score != null && (
              <span className={`score-badge ${scoreClass}`}>{Math.round(job.score)}</span>
            )}
            {job.easyApply && (
              <span
                className="tag"
                style={{ background: "rgba(79, 156, 249, 0.18)", color: "var(--accent)", marginLeft: 6 }}
              >
                Easy Apply
              </span>
            )}
            {age && (
              <span
                style={{
                  marginLeft: 8,
                  fontSize: 11,
                  color: "var(--muted)",
                  fontWeight: 400,
                }}
                title={
                  isFallback
                    ? `Fetched ${new Date(ageSource!).toLocaleString()} (no posted date)`
                    : `Posted ${new Date(ageSource!).toLocaleString()}`
                }
              >
                {isFallback ? `~${age}` : age}
              </span>
            )}
          </div>
          <div className="meta">
            {job.company} · {job.location || (job.remote ? "Remote" : "—")} ·{" "}
            <span className="tag">{job.source}</span>
            {job.status !== "new" && <span className="tag">{job.status}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
