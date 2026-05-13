import { useEffect, useState } from "react";
import { api, type Job } from "../api";

interface PlannedField {
  id: string;
  label: string;
  type: string;
  value: any;
  source: "profile" | "heuristic" | "llm" | "default" | "missing";
  confidence: number;
  reason?: string;
  required: boolean;
}

export default function ApplyPanel({ job }: { job: Job }) {
  const [appn, setAppn] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [withCover, setWithCover] = useState(false);
  const [msg, setMsg] = useState("");

  const supported = ["greenhouse", "lever", "ashby", "linkedin"].includes(job.source);
  const browserFillable = ["linkedin", "greenhouse"].includes(job.source);
  const [filling, setFilling] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await api.getApplication(job.id);
      setAppn(r);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id]);

  async function plan() {
    setPlanning(true);
    setMsg("");
    try {
      const r = await api.planApplication(job.id, withCover);
      setAppn(r);
      setMsg("Plan ready. Review fields below.");
    } catch (e: any) {
      setMsg(`Error: ${e.message}`);
    } finally {
      setPlanning(false);
    }
  }

  async function submitDryRun() {
    if (!appn) return;
    if (!confirm("Mark as applied? (dry-run — no submission to the ATS yet.)")) return;
    try {
      await api.submitApplication(appn.id, true);
      setMsg("Marked as applied.");
      await load();
    } catch (e: any) {
      setMsg(`Error: ${e.message}`);
    }
  }

  if (!supported) {
    return (
      <div className="section">
        <p style={{ color: "var(--muted)" }}>
          Auto-apply is currently supported for Greenhouse, Lever, Ashby, and LinkedIn (Easy Apply only).
          This job comes from <span className="tag">{job.source}</span> — open the posting
          and apply directly for now.
        </p>
      </div>
    );
  }

  async function fillBrowser() {
    if (!appn) return;
    setFilling(true);
    setMsg("");
    try {
      const r = await api.fillApplication(appn.id);
      setMsg(
        `Filled ${r.filled.length}/${r.filled.length + r.skipped.length} fields. Review in the browser window, then click Submit there.`
      );
    } catch (e: any) {
      setMsg(`Error: ${e.message}`);
    } finally {
      setFilling(false);
    }
  }

  const plan_ = appn?.fieldPlan ? JSON.parse(appn.fieldPlan) : null;
  const fields: PlannedField[] = plan_?.fields ?? [];
  const unresolved: PlannedField[] = plan_?.unresolved ?? [];

  return (
    <div>
      <div className="actions" style={{ marginTop: 0 }}>
        <button className="primary" onClick={plan} disabled={planning}>
          {planning ? "Planning…" : appn ? "Re-plan" : "Plan application"}
        </button>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
          <input type="checkbox" checked={withCover} onChange={(e) => setWithCover(e.target.checked)} />
          Generate cover letter
        </label>
        {appn && browserFillable && (
          <button onClick={fillBrowser} disabled={planning || filling}>
            {filling ? "Filling browser…" : "Fill in browser"}
          </button>
        )}
        {appn && (
          <button onClick={submitDryRun} disabled={planning}>
            Mark applied
          </button>
        )}
        {appn?.status === "submitted" && (
          <span className="tag" style={{ color: "var(--good)" }}>submitted</span>
        )}
        {msg && <span style={{ color: "var(--muted)", fontSize: 12 }}>{msg}</span>}
      </div>

      {browserFillable && (
        <div className="section" style={{ borderLeft: "3px solid var(--warn)", fontSize: 12 }}>
          <strong>Browser auto-apply.</strong> A Chromium window opens with its own profile.
          The bot fills fields (and attaches your uploaded resume on Greenhouse) then{" "}
          <strong>stops before Submit</strong>. You review and click Submit yourself.
          {job.source === "linkedin" && " On first run, sign in to LinkedIn in the opened window."}
        </div>
      )}

      {loading && !appn ? (
        <div className="empty">Loading…</div>
      ) : !appn ? (
        <div className="section">
          <p style={{ color: "var(--muted)" }}>
            No application drafted yet. Click <strong>Plan application</strong> to fetch the form
            schema and pre-fill answers from your profile (heuristics + Claude for ambiguous fields).
          </p>
        </div>
      ) : (
        <>
          {unresolved.length > 0 && (
            <div className="section" style={{ borderLeft: "3px solid var(--warn)" }}>
              <h4 style={{ color: "var(--warn)", margin: 0 }}>
                {unresolved.length} required field{unresolved.length === 1 ? "" : "s"} need your attention
              </h4>
              <ul style={{ marginBottom: 0 }}>
                {unresolved.map((u) => (
                  <li key={u.id}>
                    <strong>{u.label}</strong> — {u.reason ?? "missing value"}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {appn.coverLetter && (
            <div className="section">
              <h4>Cover letter</h4>
              <pre>{appn.coverLetter}</pre>
              <button onClick={() => navigator.clipboard.writeText(appn.coverLetter)}>Copy</button>
            </div>
          )}

          <div className="section">
            <h4>Field plan ({fields.length} fields)</h4>
            <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 0 }}>
              Edit any value below — it's saved on this draft and will be used when submitting.
            </p>
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ color: "var(--muted)" }}>
                  <th style={th}>Label</th>
                  <th style={th}>Value</th>
                  <th style={th}>Source</th>
                  <th style={th}>Conf.</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f) => (
                  <FieldRow key={f.id} app={appn} field={f} onChange={load} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function FieldRow({
  app,
  field,
  onChange,
}: {
  app: any;
  field: PlannedField;
  onChange: () => void;
}) {
  const [value, setValue] = useState<any>(field.value ?? "");
  const [dirty, setDirty] = useState(false);

  async function save() {
    await api.updateField(app.id, field.id, value);
    setDirty(false);
    onChange();
  }

  const color =
    field.source === "missing"
      ? "var(--bad)"
      : field.confidence >= 0.85
        ? "var(--good)"
        : field.confidence >= 0.6
          ? "var(--warn)"
          : "var(--bad)";

  return (
    <tr>
      <td style={td}>
        {field.label}
        {field.required && <span style={{ color: "var(--bad)" }}> *</span>}
        {field.reason && (
          <div style={{ color: "var(--muted)", fontSize: 11 }}>{field.reason}</div>
        )}
      </td>
      <td style={td}>
        {field.type === "textarea" ? (
          <textarea
            style={{ width: "100%", minHeight: 60 }}
            value={value ?? ""}
            onChange={(e) => {
              setValue(e.target.value);
              setDirty(true);
            }}
          />
        ) : (
          <input
            style={{ width: "100%" }}
            value={value ?? ""}
            onChange={(e) => {
              setValue(e.target.value);
              setDirty(true);
            }}
          />
        )}
        {dirty && (
          <button style={{ marginTop: 4 }} onClick={save}>
            Save override
          </button>
        )}
      </td>
      <td style={td}>{field.source}</td>
      <td style={{ ...td, color }}>{Math.round(field.confidence * 100)}%</td>
    </tr>
  );
}

const th: React.CSSProperties = { textAlign: "left", padding: "6px 8px", borderBottom: "1px solid var(--border)" };
const td: React.CSSProperties = { padding: "6px 8px", borderBottom: "1px solid var(--border)", verticalAlign: "top" };
