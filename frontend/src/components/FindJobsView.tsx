import { useState } from "react";
import { api } from "../api";

type Portal = "linkedin" | "indeed" | "greenhouse" | "lever" | "ashby" | "all";

interface Props {
  onDone: (filters: { source?: string; hours?: string; q?: string }) => void;
}

const PORTAL_LABELS: Record<Portal, string> = {
  linkedin: "LinkedIn",
  indeed: "Indeed",
  greenhouse: "Greenhouse boards",
  lever: "Lever boards",
  ashby: "Ashby boards",
  all: "All sources (curated companies + searches)",
};

const POPULAR_LOCATIONS = [
  "Bengaluru, India",
  "Mumbai, India",
  "Delhi NCR, India",
  "Hyderabad, India",
  "Pune, India",
  "India",
  "Remote",
  "United States",
  "San Francisco, CA",
  "New York, NY",
  "London, UK",
];

const POPULAR_KEYWORDS = [
  "full stack engineer",
  "software development engineer",
  "MERN stack developer",
  "Next.js developer",
  "React developer",
  "Node.js engineer",
  "AI engineer",
  "backend engineer",
];

export default function FindJobsView({ onDone }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [portal, setPortal] = useState<Portal>("linkedin");
  const [location, setLocation] = useState("Bengaluru, India");
  const [keywords, setKeywords] = useState("full stack engineer");
  const [hours, setHours] = useState<"24" | "48" | "168" | "720" | "">("48");
  const [easyApplyOnly, setEasyApplyOnly] = useState(false);
  const [pages, setPages] = useState(2);

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>("");
  const [error, setError] = useState<string>("");

  const isKeywordSource = portal === "linkedin" || portal === "indeed";
  const isBoardSource = portal === "greenhouse" || portal === "lever" || portal === "ashby";

  async function fetchNow() {
    setBusy(true);
    setError("");
    setResult("");
    try {
      if (portal === "all") {
        const r = await api.ingestAll({
          hours: hours ? Number(hours) : undefined,
        });
        setResult(
          `Scanned ${r.totalCompanies} sources · ${r.totalJobs} postings · ${r.kept} within window · ${r.inserted} saved.`
        );
      } else if (isBoardSource) {
        // For a single company slug, use /api/ingest
        const r = await api.ingest({
          source: portal,
          query: keywords.trim(), // company slug typed in keywords box
          pages,
        });
        setResult(`Inserted ${r.inserted} of ${r.total} from ${portal} (${keywords}).`);
      } else {
        // LinkedIn / Indeed keyword search
        const r = await api.ingest({
          source: portal,
          query: keywords.trim(),
          location: location.trim() || undefined,
          pages,
          // The base /api/ingest doesn't currently take hours, but the
          // scraper functions respect it via opts.hours at the source level.
          // We rely on /api/ingest-all for time-windowed bulk, so for single
          // searches we keep "hours" as a follow-up filter on the Jobs page.
        } as any);
        setResult(`Inserted ${r.inserted} of ${r.total} from ${portal}.`);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function gotoJobs() {
    onDone({
      source: portal === "all" ? undefined : portal,
      hours: hours || undefined,
      q: isKeywordSource ? keywords : undefined,
    });
  }

  return (
    <>
      <div className="toolbar">
        <strong>Find jobs</strong>
        <span style={{ color: "var(--muted)", fontSize: 12 }}>
          Pick a portal → pick a location → fetch → review.
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              style={{
                width: 24,
                height: 24,
                borderRadius: "50%",
                background: step >= n ? "var(--accent)" : "var(--panel-2)",
                color: step >= n ? "white" : "var(--muted)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
              }}
            >
              {n}
            </div>
          ))}
        </div>
      </div>

      <div className="content">
        {step === 1 && (
          <div className="section" style={{ maxWidth: 720 }}>
            <h4>1. Where do you want to look?</h4>
            <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 0 }}>
              Pick a single portal, or scan all curated sources at once.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
              {(Object.keys(PORTAL_LABELS) as Portal[]).map((p) => (
                <label
                  key={p}
                  style={{
                    border: `1px solid ${portal === p ? "var(--accent)" : "var(--border)"}`,
                    background: portal === p ? "var(--panel-2)" : "transparent",
                    padding: "10px 12px",
                    borderRadius: 6,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="portal"
                    checked={portal === p}
                    onChange={() => setPortal(p)}
                    style={{ marginRight: 8 }}
                  />
                  <strong>{PORTAL_LABELS[p]}</strong>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                    {p === "linkedin" && "Public job search · Easy Apply detected"}
                    {p === "indeed" && "Best with SCRAPER_API_KEY · works partially"}
                    {p === "greenhouse" && "Public board API · one company at a time"}
                    {p === "lever" && "Public board API · one company at a time"}
                    {p === "ashby" && "Public board API · one company at a time"}
                    {p === "all" && "Curated 70+ companies + LinkedIn keyword searches"}
                  </div>
                </label>
              ))}
            </div>
            <div style={{ marginTop: 16 }}>
              <button className="primary" onClick={() => setStep(2)}>
                Next →
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="section" style={{ maxWidth: 720 }}>
            <h4>2. What and where?</h4>

            {isKeywordSource && (
              <>
                <div className="form-grid">
                  <label>Keywords</label>
                  <input
                    value={keywords}
                    onChange={(e) => setKeywords(e.target.value)}
                    placeholder="full stack engineer"
                  />

                  <label>Location</label>
                  <input
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="Bengaluru, India / Remote"
                  />

                  <label>Pages</label>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={pages}
                    onChange={(e) => setPages(Number(e.target.value))}
                    style={{ width: 80 }}
                  />

                  {portal === "linkedin" && (
                    <>
                      <label>Easy Apply only</label>
                      <label style={{ paddingTop: 6 }}>
                        <input
                          type="checkbox"
                          checked={easyApplyOnly}
                          onChange={(e) => setEasyApplyOnly(e.target.checked)}
                        />{" "}
                        Only jobs the bot can auto-apply to
                      </label>
                    </>
                  )}
                </div>
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                    Quick picks:
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {POPULAR_KEYWORDS.map((k) => (
                      <button key={k} onClick={() => setKeywords(k)} style={{ fontSize: 11 }}>
                        {k}
                      </button>
                    ))}
                  </div>
                  <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {POPULAR_LOCATIONS.map((l) => (
                      <button key={l} onClick={() => setLocation(l)} style={{ fontSize: 11 }}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {isBoardSource && (
              <>
                <p style={{ color: "var(--muted)", fontSize: 12 }}>
                  Enter the company slug from their board URL — e.g. <code>stripe</code> for{" "}
                  <code>boards.greenhouse.io/stripe</code>.
                </p>
                <div className="form-grid">
                  <label>Company slug</label>
                  <input
                    value={keywords}
                    onChange={(e) => setKeywords(e.target.value)}
                    placeholder={portal === "greenhouse" ? "airbnb" : portal === "lever" ? "netflix" : "linear"}
                  />
                </div>
              </>
            )}

            {portal === "all" && (
              <p style={{ color: "var(--muted)", fontSize: 13 }}>
                Will scan every curated company across Greenhouse, Lever, and Ashby, plus all the
                LinkedIn keyword searches in <code>backend/src/sources/companies.ts</code>. This
                can take 30-60 seconds.
              </p>
            )}

            <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
              <button onClick={() => setStep(1)}>← Back</button>
              <button className="primary" onClick={() => setStep(3)}>
                Next →
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="section" style={{ maxWidth: 720 }}>
            <h4>3. How fresh?</h4>
            <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 0 }}>
              Time window. Greenhouse/Lever/Ashby use real posted dates; LinkedIn uses its native
              "posted within" filter; Indeed uses "days ago".
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
              {[
                { value: "24", label: "Last 24h" },
                { value: "48", label: "Last 48h" },
                { value: "168", label: "Last 7 days" },
                { value: "720", label: "Last 30 days" },
              ].map((opt) => (
                <label
                  key={opt.value}
                  style={{
                    border: `1px solid ${hours === opt.value ? "var(--accent)" : "var(--border)"}`,
                    background: hours === opt.value ? "var(--panel-2)" : "transparent",
                    padding: "10px 12px",
                    borderRadius: 6,
                    cursor: "pointer",
                    textAlign: "center",
                  }}
                >
                  <input
                    type="radio"
                    name="hours"
                    checked={hours === opt.value}
                    onChange={() => setHours(opt.value as any)}
                    style={{ display: "none" }}
                  />
                  <strong>{opt.label}</strong>
                </label>
              ))}
            </div>

            <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
              <button onClick={() => setStep(2)}>← Back</button>
              <button className="primary" disabled={busy} onClick={fetchNow}>
                {busy ? "Fetching..." : "Fetch jobs"}
              </button>
              {result && (
                <button onClick={gotoJobs}>
                  View jobs →
                </button>
              )}
            </div>

            {result && (
              <div
                style={{
                  marginTop: 16,
                  padding: 12,
                  background: "rgba(67, 192, 138, 0.12)",
                  border: "1px solid var(--good)",
                  borderRadius: 6,
                }}
              >
                ✓ {result}
              </div>
            )}
            {error && (
              <div
                style={{
                  marginTop: 16,
                  padding: 12,
                  background: "rgba(237, 106, 106, 0.12)",
                  border: "1px solid var(--bad)",
                  borderRadius: 6,
                }}
              >
                {error}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
