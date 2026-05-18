import { useEffect, useState } from "react";
import { api } from "../api";

const HINTS: Record<string, string> = {
  greenhouse: "Company slug, e.g. stripe, airbnb, robinhood",
  lever: "Company slug, e.g. netflix, plaid",
  ashby: "Org slug, e.g. linear, ramp",
  linkedin: "Keywords, e.g. 'senior software engineer'",
  indeed: "Keywords, e.g. 'backend engineer typescript'",
};

export default function IngestView() {
  const [source, setSource] = useState("greenhouse");
  const [query, setQuery] = useState("stripe");
  const [location, setLocation] = useState("");
  const [pages, setPages] = useState(1);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>("");
  const [runs, setRuns] = useState<any[]>([]);
  const [bulkHours, setBulkHours] = useState<string>("48");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<string>("");

  async function loadRuns() {
    setRuns(await api.runs());
  }
  useEffect(() => { loadRuns(); }, []);

  async function go() {
    setBusy(true);
    setResult("");
    try {
      const r = await api.ingest({ source, query, location: location || undefined, pages });
      setResult(`Inserted ${r.inserted} of ${r.total} from ${source}.`);
      await loadRuns();
    } catch (e: any) {
      setResult(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  const showLocAndPages = source === "linkedin" || source === "indeed";

  async function bulk() {
    setBulkBusy(true);
    setBulkResult("");
    try {
      const r = await api.ingestAll({
        hours: bulkHours ? Number(bulkHours) : undefined,
      });
      setBulkResult(
        `Scanned ${r.totalCompanies} companies → ${r.totalJobs} postings, ${r.kept} within window, ${r.inserted} saved` +
          (r.errors.length ? ` (${r.errors.length} company errors)` : "")
      );
      await loadRuns();
    } catch (e: any) {
      setBulkResult(`Error: ${e.message}`);
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <>
      <div className="toolbar">
        <strong>Ingest jobs</strong>
      </div>
      <div className="content">
        <div className="section" style={{ maxWidth: 720 }}>
          <h4>Fetch latest from all curated companies</h4>
          <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 0 }}>
            Pulls Greenhouse + Lever + Ashby boards for ~50 top tech companies, plus broad
            keyword sweeps on LinkedIn and Indeed (India + Remote) — all in parallel, keeping
            only postings within the time window.
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <label style={{ color: "var(--muted)", fontSize: 12 }}>Time window:</label>
            <select value={bulkHours} onChange={(e) => setBulkHours(e.target.value)}>
              <option value="24">Last 24h</option>
              <option value="48">Last 48h</option>
              <option value="168">Last 7 days</option>
              <option value="720">Last 30 days</option>
              <option value="">All time</option>
            </select>
            <button className="primary" onClick={bulk} disabled={bulkBusy}>
              {bulkBusy ? "Fetching… (may take ~30s)" : "Fetch all"}
            </button>
            {bulkResult && (
              <span style={{ color: "var(--muted)", fontSize: 12 }}>{bulkResult}</span>
            )}
          </div>
        </div>

        <div className="section" style={{ maxWidth: 720 }}>
          <div className="form-grid">
            <label>Source</label>
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="greenhouse">Greenhouse</option>
              <option value="lever">Lever</option>
              <option value="ashby">Ashby</option>
              <option value="linkedin">LinkedIn</option>
              <option value="indeed">Indeed</option>
            </select>

            <label>Query</label>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={HINTS[source]} />

            {showLocAndPages && (
              <>
                <label>Location</label>
                <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Remote, San Francisco" />

                <label>Pages</label>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={pages}
                  onChange={(e) => setPages(Number(e.target.value))}
                  style={{ width: 80 }}
                />
              </>
            )}

            <div />
            <div>
              <button className="primary" onClick={go} disabled={busy || !query.trim()}>
                {busy ? "Ingesting…" : "Ingest"}
              </button>
              {result && <span style={{ marginLeft: 12, color: "var(--muted)" }}>{result}</span>}
            </div>
          </div>
        </div>

        <div className="section">
          <h4>Recent runs</h4>
          {runs.length === 0 ? (
            <div className="empty">No runs yet.</div>
          ) : (
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ color: "var(--muted)" }}>
                  <th style={th}>Source</th>
                  <th style={th}>Query</th>
                  <th style={th}>Count</th>
                  <th style={th}>Started</th>
                  <th style={th}>Error</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td style={td}>{r.source}</td>
                    <td style={td}>{r.query}</td>
                    <td style={td}>{r.count}</td>
                    <td style={td}>{new Date(r.startedAt).toLocaleString()}</td>
                    <td style={{ ...td, color: "var(--bad)" }}>{r.error ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}

const th: React.CSSProperties = { textAlign: "left", padding: "6px 8px", borderBottom: "1px solid var(--border)" };
const td: React.CSSProperties = { padding: "6px 8px", borderBottom: "1px solid var(--border)" };
