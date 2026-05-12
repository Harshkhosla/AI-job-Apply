import { useEffect, useState } from "react";
import { api } from "../api";

export default function ApplicationsView() {
  const [items, setItems] = useState<any[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setItems(await api.listApplications(status || undefined));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  return (
    <>
      <div className="toolbar">
        <strong>Applications</strong>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="preview">Preview</option>
          <option value="submitted">Submitted</option>
          <option value="failed">Failed</option>
        </select>
        <button onClick={load} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
          {items.length} applications
        </span>
      </div>
      <div className="content">
        {items.length === 0 ? (
          <div className="empty">
            No applications yet. Open a Greenhouse/Lever/Ashby job and click <strong>Apply</strong> → <strong>Plan application</strong>.
          </div>
        ) : (
          <div className="section">
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ color: "var(--muted)" }}>
                  <th style={th}>Company</th>
                  <th style={th}>Title</th>
                  <th style={th}>Source</th>
                  <th style={th}>Status</th>
                  <th style={th}>Unresolved</th>
                  <th style={th}>Updated</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => {
                  const plan = a.fieldPlan ? safeJson(a.fieldPlan) : null;
                  return (
                    <tr key={a.id}>
                      <td style={td}>{a.job?.company}</td>
                      <td style={td}>{a.job?.title}</td>
                      <td style={td}><span className="tag">{a.job?.source}</span></td>
                      <td style={td}>{a.status}</td>
                      <td style={{ ...td, color: plan?.unresolved?.length ? "var(--warn)" : "var(--muted)" }}>
                        {plan?.unresolved?.length ?? 0}
                      </td>
                      <td style={td}>{new Date(a.updatedAt).toLocaleString()}</td>
                      <td style={td}>
                        <a href={a.job?.url} target="_blank" rel="noreferrer">Open</a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function safeJson(s: string) {
  try { return JSON.parse(s); } catch { return null; }
}

const th: React.CSSProperties = { textAlign: "left", padding: "6px 8px", borderBottom: "1px solid var(--border)" };
const td: React.CSSProperties = { padding: "6px 8px", borderBottom: "1px solid var(--border)" };
