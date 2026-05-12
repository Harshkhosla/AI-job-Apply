import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { api, type Job } from "../api";

export default function JobDetail({ job, onChange }: { job: Job; onChange: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [resume, setResume] = useState<string | null>(job.tailoredResume ?? null);
  const [outreach, setOutreach] = useState<{ subject: string; body: string } | null>(
    job.outreach ? safeParse(job.outreach) : null
  );
  const score = job.scoreReason ? safeParse(job.scoreReason) : null;

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try {
      await fn();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <h2>{job.title}</h2>
      <div className="company">
        {job.company} · {job.location || (job.remote ? "Remote" : "—")} · <span className="tag">{job.source}</span>
      </div>

      <div className="actions">
        <a href={job.url} target="_blank" rel="noreferrer"><button className="primary">Open posting →</button></a>
        <button onClick={() => run("score", async () => { await api.score(job.id); onChange(); })} disabled={!!busy}>
          {busy === "score" ? "Scoring…" : "Score"}
        </button>
        <button onClick={() => run("resume", async () => { const r = await api.resume(job.id); setResume(r.resume); onChange(); })} disabled={!!busy}>
          {busy === "resume" ? "Tailoring…" : "Tailor resume"}
        </button>
        <button onClick={() => run("outreach", async () => { const o = await api.outreach(job.id); setOutreach(o); onChange(); })} disabled={!!busy}>
          {busy === "outreach" ? "Drafting…" : "Outreach"}
        </button>
        <select
          value={job.status}
          onChange={async (e) => { await api.updateJob(job.id, { status: e.target.value }); onChange(); }}
        >
          <option value="new">New</option>
          <option value="shortlisted">Shortlisted</option>
          <option value="applied">Applied</option>
          <option value="rejected">Rejected</option>
          <option value="hidden">Hidden</option>
        </select>
      </div>

      {score && (
        <div className="section">
          <h4>Fit Score: {Math.round(score.score)} / 100</h4>
          <p>{score.fitSummary}</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <strong style={{ color: "var(--good)" }}>Pros</strong>
              <ul>{(score.pros ?? []).map((p: string, i: number) => <li key={i}>{p}</li>)}</ul>
            </div>
            <div>
              <strong style={{ color: "var(--bad)" }}>Cons</strong>
              <ul>{(score.cons ?? []).map((p: string, i: number) => <li key={i}>{p}</li>)}</ul>
            </div>
          </div>
        </div>
      )}

      {outreach && (
        <div className="section">
          <h4>Outreach draft</h4>
          <div style={{ marginBottom: 8 }}><strong>Subject:</strong> {outreach.subject}</div>
          <pre>{outreach.body}</pre>
          <button onClick={() => navigator.clipboard.writeText(`${outreach.subject}\n\n${outreach.body}`)}>
            Copy
          </button>
        </div>
      )}

      {resume && (
        <div className="section">
          <h4>Tailored resume</h4>
          <div style={{ background: "var(--bg)", padding: 12, borderRadius: 6 }}>
            <ReactMarkdown>{resume}</ReactMarkdown>
          </div>
          <button style={{ marginTop: 8 }} onClick={() => navigator.clipboard.writeText(resume)}>Copy Markdown</button>
        </div>
      )}

      <div className="section">
        <h4>Job description</h4>
        <pre style={{ maxHeight: 300, overflow: "auto" }}>{job.description || "(no description fetched)"}</pre>
      </div>
    </div>
  );
}

function safeParse(s: string): any {
  try { return JSON.parse(s); } catch { return null; }
}
