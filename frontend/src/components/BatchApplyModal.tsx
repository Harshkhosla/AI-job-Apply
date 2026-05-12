import { useEffect, useRef, useState } from "react";
import { api, type Job } from "../api";

interface Props {
  jobs: Job[];
  onClose: () => void;
}

export default function BatchApplyModal({ jobs, onClose }: Props) {
  const [batch, setBatch] = useState<any | null>(null);
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState("");
  const pollRef = useRef<number | null>(null);

  // Map jobId → title/company for display
  const jobIndex = new Map(jobs.map((j) => [j.id, j]));

  async function start() {
    setStarting(true);
    setErr("");
    try {
      const s = await api.startBatch(jobs.map((j) => j.id));
      setBatch(s);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setStarting(false);
    }
  }

  // Poll the batch status while running
  useEffect(() => {
    if (!batch) return;
    if (batch.status === "done" || batch.status === "cancelled") return;
    const tick = async () => {
      try {
        const s = await api.getBatch(batch.id);
        setBatch(s);
      } catch {
        // ignore
      }
    };
    pollRef.current = window.setInterval(tick, 1500);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [batch?.id, batch?.status]);

  async function advance() {
    if (!batch) return;
    await api.nextBatch(batch.id);
    // Optimistically refresh
    const s = await api.getBatch(batch.id);
    setBatch(s);
  }

  async function cancel() {
    if (!batch) {
      onClose();
      return;
    }
    if (!confirm("Cancel batch? Current Chromium window stays open.")) return;
    await api.cancelBatch(batch.id);
    const s = await api.getBatch(batch.id);
    setBatch(s);
  }

  const currentIdx = batch?.currentIndex ?? -1;
  const isWaiting =
    batch?.status === "paused" &&
    currentIdx >= 0 &&
    batch.jobs[currentIdx]?.phase === "awaiting_user_submit";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && (batch?.status === "done" || batch?.status === "cancelled" || !batch)) {
          onClose();
        }
      }}
    >
      <div
        style={{
          width: 720,
          maxHeight: "85vh",
          overflow: "auto",
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: 20,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Batch Apply · {jobs.length} jobs</h3>
          <button onClick={cancel}>{batch ? (batch.status === "done" || batch.status === "cancelled" ? "Close" : "Cancel") : "Close"}</button>
        </div>

        {!batch && (
          <>
            <p style={{ color: "var(--muted)" }}>
              Bot will plan + auto-fill each job sequentially. Between jobs, it waits for you to
              review and click <strong>Submit application</strong> in the Chromium window, then click
              <strong> Next job</strong> here to move on.
            </p>
            <ul style={{ fontSize: 13 }}>
              {jobs.map((j) => (
                <li key={j.id}>
                  <strong>{j.title}</strong> — {j.company}{" "}
                  {j.easyApply && <span className="tag">Easy Apply</span>}
                </li>
              ))}
            </ul>
            <button className="primary" disabled={starting} onClick={start}>
              {starting ? "Starting..." : "Start batch"}
            </button>
            {err && <div style={{ color: "var(--bad)", marginTop: 8 }}>{err}</div>}
          </>
        )}

        {batch && (
          <>
            <div style={{ margin: "12px 0", fontSize: 12, color: "var(--muted)" }}>
              Status: <strong style={{ color: "var(--text)" }}>{batch.status}</strong>
              {currentIdx >= 0 && ` · current: ${currentIdx + 1}/${batch.jobs.length}`}
            </div>

            <div className="section" style={{ padding: 0, background: "transparent" }}>
              {batch.jobs.map((s: any, i: number) => {
                const j = jobIndex.get(s.jobId);
                const isCurrent = i === currentIdx;
                return (
                  <div
                    key={s.jobId}
                    style={{
                      padding: 10,
                      borderLeft: isCurrent ? "3px solid var(--accent)" : "3px solid transparent",
                      borderBottom: "1px solid var(--border)",
                      background: isCurrent ? "var(--panel-2)" : "transparent",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <div>
                        <strong>{j?.title ?? s.jobId}</strong>
                        <span style={{ color: "var(--muted)", marginLeft: 8 }}>{j?.company}</span>
                      </div>
                      <div>
                        <PhaseBadge phase={s.phase} />
                      </div>
                    </div>
                    {s.message && (
                      <div style={{ marginTop: 6, fontSize: 12, color: "var(--muted)" }}>
                        {s.message}
                      </div>
                    )}
                    {(s.filled != null || s.skipped != null) && (
                      <div style={{ marginTop: 4, fontSize: 12, color: "var(--muted)" }}>
                        Filled {s.filled ?? 0} · skipped {s.skipped ?? 0}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {isWaiting && (
              <div
                style={{
                  marginTop: 16,
                  padding: 12,
                  background: "rgba(232, 177, 92, 0.12)",
                  border: "1px solid var(--warn)",
                  borderRadius: 6,
                }}
              >
                <strong>Your turn.</strong> Review the Chromium window, click{" "}
                <strong>Submit application</strong>, then press the button below to move to the next
                job. The bot will <strong>not</strong> auto-click Submit.
                <div style={{ marginTop: 8 }}>
                  <button className="primary" onClick={advance}>
                    I submitted — next job →
                  </button>
                  <button style={{ marginLeft: 8 }} onClick={advance}>
                    Skip this job (mark as advanced)
                  </button>
                </div>
              </div>
            )}

            {(batch.status === "done" || batch.status === "cancelled") && (
              <div style={{ marginTop: 16, padding: 12, background: "var(--panel-2)", borderRadius: 6 }}>
                Batch {batch.status}.
                <button style={{ marginLeft: 8 }} onClick={onClose}>
                  Close
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PhaseBadge({ phase }: { phase: string }) {
  const color =
    phase === "submitted" ? "var(--good)" :
    phase === "failed" ? "var(--bad)" :
    phase === "awaiting_user_submit" ? "var(--warn)" :
    "var(--muted)";
  return (
    <span className="tag" style={{ color, borderColor: color }}>
      {phase}
    </span>
  );
}
