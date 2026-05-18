import { useState } from "react";
import { api } from "../api";

type Portal = "linkedin" | "indeed" | "greenhouse" | "lever" | "ashby" | "all";

interface Props {
  onDone: (filters: { source?: string; hours?: string; q?: string }) => void;
}

// LinkedIn-only mode: other portals commented out. Re-enable by restoring
// these entries and uncommenting step 1 / fetchNow branches below.
const PORTAL_LABELS: Record<Portal, string> = {
  linkedin: "LinkedIn",
  // indeed: "Indeed",
  // greenhouse: "Greenhouse boards",
  // lever: "Lever boards",
  // ashby: "Ashby boards",
  // all: "All sources (curated companies + searches)",
} as Record<Portal, string>;
// Reference so TS doesn't complain about unused symbol while the table is trimmed.
void PORTAL_LABELS;

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
  // LinkedIn-only mode: stepper reduced from 3 → 2 steps.
  const [step, setStep] = useState<1 | 2>(1);
  // Locked to LinkedIn. Setter retained so re-enabling the portal picker is a one-line uncomment.
  const [portal /*, setPortal */] = useState<Portal>("linkedin");
  const [location, setLocation] = useState("Bengaluru, India");
  const [keywords, setKeywords] = useState("full stack engineer");
  // LinkedIn-only mode capped at 5 days (server-enforced). Older options removed.
  const [hours, setHours] = useState<"24" | "48" | "72" | "120" | "">("48");
  // LinkedIn-only mode: always restrict ingest to Easy Apply postings so the
  // auto-apply flow can actually act on them. Toggle is hidden in the UI.
  const [easyApplyOnly, setEasyApplyOnly] = useState(true);
  const [pages, setPages] = useState(2);

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>("");
  const [error, setError] = useState<string>("");

  const isKeywordSource = portal === "linkedin" || portal === "indeed";
  // const isBoardSource = portal === "greenhouse" || portal === "lever" || portal === "ashby";

  async function fetchNow() {
    setBusy(true);
    setError("");
    setResult("");
    try {
      // LinkedIn-only mode: board / "all" branches commented out.
      // if (portal === "all") {
      //   const r = await api.ingestAll({
      //     hours: hours ? Number(hours) : undefined,
      //   });
      //   setResult(
      //     `Scanned ${r.totalCompanies} sources · ${r.totalJobs} postings · ${r.kept} within window · ${r.inserted} saved.`
      //   );
      // } else if (isBoardSource) {
      //   const r = await api.ingest({
      //     source: portal,
      //     query: keywords.trim(),
      //     pages,
      //   });
      //   setResult(`Inserted ${r.inserted} of ${r.total} from ${portal} (${keywords}).`);
      // } else {
      // LinkedIn / Indeed keyword search. Forwarding `hours` is what makes
      // LinkedIn's f_TPR ("posted within") filter actually kick in — without
      // this, results come back default-sorted and full of stale postings.
      const r = await api.ingest({
        source: portal,
        query: keywords.trim(),
        location: location.trim() || undefined,
        pages,
        hours: hours ? Number(hours) : undefined,
        easyApplyOnly: portal === "linkedin" ? easyApplyOnly : undefined,
      });
      setResult(
        `Inserted ${r.inserted} of ${r.total} from ${portal}` +
          (r.purged ? ` · purged ${r.purged} stale.` : ".")
      );
      // }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function gotoJobs() {
    onDone({
      // LinkedIn-only mode: source always pinned.
      source: "linkedin",
      hours: hours || undefined,
      q: isKeywordSource ? keywords : undefined,
    });
  }


  return (
    <>
      <div className="toolbar">
        <strong>Find LinkedIn jobs</strong>
        <span style={{ color: "var(--muted)", fontSize: 12 }}>
          Pick keywords + location → fetch → review.
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          {[1, 2].map((n) => (
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
        {/*
        LinkedIn-only mode: portal-picker step commented out. To re-enable,
        restore `step === 1` block, uncomment PORTAL_LABELS entries, and
        switch the stepper back to 1 | 2 | 3.

        {step === 1 && (
          <div className="section" style={{ maxWidth: 720 }}>
            <h4>1. Where do you want to look?</h4>
            ...
          </div>
        )}
        */}

        {step === 1 && (
          <div className="section" style={{ maxWidth: 720 }}>
            <h4>1. What and where?</h4>

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

                  {/*
                  LinkedIn Easy-Apply toggle hidden in this mode — the Jobs
                  view exposes the same filter and it's the more useful place.
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
                  */}
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

            {/*
            Board / "all" branches commented out — LinkedIn-only mode.

            {isBoardSource && (
              <>
                <p style={{ color: "var(--muted)", fontSize: 12 }}>
                  Enter the company slug from their board URL — e.g. <code>stripe</code>.
                </p>
                <div className="form-grid">
                  <label>Company slug</label>
                  <input
                    value={keywords}
                    onChange={(e) => setKeywords(e.target.value)}
                  />
                </div>
              </>
            )}

            {portal === "all" && (
              <p style={{ color: "var(--muted)", fontSize: 13 }}>
                Will scan every curated company across Greenhouse, Lever, and Ashby...
              </p>
            )}
            */}

            <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
              <button className="primary" onClick={() => setStep(2)}>
                Next →
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="section" style={{ maxWidth: 720 }}>
            <h4>2. How fresh?</h4>
            <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 0 }}>
              Time window. LinkedIn uses its native "posted within" filter.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
              {[
                { value: "24", label: "Last 24h" },
                { value: "48", label: "Last 48h" },
                { value: "72", label: "Last 3 days" },
                { value: "120", label: "Last 5 days" },
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
              <button onClick={() => setStep(1)}>← Back</button>
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
