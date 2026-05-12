import { useEffect, useState } from "react";
import { api, type Profile } from "../api";

const EMPTY: Profile = {
  name: "",
  email: "",
  skills: [],
  experience: [],
  education: [],
};

interface Prefs {
  targetRoles?: string[];
  locations?: string[];
  remoteOk?: boolean;
  onsiteOk?: boolean;
  hybridOk?: boolean;
  openToRelocate?: boolean;
  visaSponsorship?: boolean;
  yearsExperience?: number;
  seniorityTarget?: string;
  minSalary?: number;
  currency?: string;
}

export default function ProfileView() {
  const [profile, setProfile] = useState<Profile>(EMPTY);
  const [prefs, setPrefs] = useState<Prefs>({});
  const [links, setLinks] = useState<{ github?: string; linkedin?: string; portfolio?: string }>({});
  const [json, setJson] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [showJson, setShowJson] = useState(false);

  useEffect(() => {
    api.getProfile().then((p) => {
      if (p) {
        setProfile(p);
        setPrefs((p.preferences ?? {}) as Prefs);
        setLinks(p.links ?? {});
        setJson(JSON.stringify(p, null, 2));
      }
    });
  }, []);

  async function save() {
    setSaving(true);
    setMsg("");
    try {
      const updated: Profile = {
        ...profile,
        preferences: prefs,
        links,
      };
      await api.saveProfile(updated);
      setProfile(updated);
      setJson(JSON.stringify(updated, null, 2));
      setMsg("Saved. Re-score jobs to see improved fit scores.");
    } catch (e: any) {
      setMsg(`Error: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function saveJson() {
    setSaving(true);
    setMsg("");
    try {
      const parsed = JSON.parse(json) as Profile;
      await api.saveProfile(parsed);
      setProfile(parsed);
      setPrefs((parsed.preferences ?? {}) as Prefs);
      setLinks(parsed.links ?? {});
      setMsg("Saved.");
    } catch (e: any) {
      setMsg(`Error: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  const togglePref = (key: keyof Prefs) => (e: any) =>
    setPrefs({ ...prefs, [key]: e.target.checked });

  return (
    <>
      <div className="toolbar">
        <strong>Profile</strong>
        <span style={{ color: "var(--muted)", fontSize: 12 }}>
          Used by Claude to score and tailor.
        </span>
        <button onClick={() => setShowJson(!showJson)} style={{ marginLeft: "auto" }}>
          {showJson ? "Quick edit" : "Advanced (JSON)"}
        </button>
      </div>
      <div className="content">
        {!showJson ? (
          <>
            <div className="section">
              <h4>Work setup</h4>
              <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 0 }}>
                These directly affect your fit score — Claude rewards jobs that match.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 8 }}>
                <label><input type="checkbox" checked={!!prefs.remoteOk} onChange={togglePref("remoteOk")} /> Open to remote</label>
                <label><input type="checkbox" checked={!!prefs.onsiteOk} onChange={togglePref("onsiteOk")} /> Open to onsite</label>
                <label><input type="checkbox" checked={!!prefs.hybridOk} onChange={togglePref("hybridOk")} /> Open to hybrid</label>
                <label><input type="checkbox" checked={!!prefs.openToRelocate} onChange={togglePref("openToRelocate")} /> Open to relocation</label>
                <label><input type="checkbox" checked={!!prefs.visaSponsorship} onChange={togglePref("visaSponsorship")} /> Need visa sponsorship</label>
              </div>
            </div>

            <div className="section">
              <h4>Targets</h4>
              <div className="form-grid">
                <label>Target roles</label>
                <input
                  placeholder="Full Stack Engineer, SDE, AI Engineer"
                  value={(prefs.targetRoles ?? []).join(", ")}
                  onChange={(e) =>
                    setPrefs({ ...prefs, targetRoles: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })
                  }
                />

                <label>Preferred locations</label>
                <input
                  placeholder="Bengaluru, Remote, San Francisco"
                  value={(prefs.locations ?? []).join(", ")}
                  onChange={(e) =>
                    setPrefs({ ...prefs, locations: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })
                  }
                />

                <label>Years of experience</label>
                <input
                  type="number"
                  min={0}
                  max={40}
                  style={{ width: 100 }}
                  value={prefs.yearsExperience ?? ""}
                  onChange={(e) =>
                    setPrefs({ ...prefs, yearsExperience: e.target.value ? Number(e.target.value) : undefined })
                  }
                />

                <label>Seniority target</label>
                <select
                  value={prefs.seniorityTarget ?? ""}
                  onChange={(e) => setPrefs({ ...prefs, seniorityTarget: e.target.value || undefined })}
                >
                  <option value="">(any)</option>
                  <option value="Intern">Intern</option>
                  <option value="New Grad / Junior">New Grad / Junior</option>
                  <option value="Mid-level (SDE 1-2)">Mid-level (SDE 1-2)</option>
                  <option value="Senior">Senior</option>
                  <option value="Staff+">Staff+</option>
                </select>

                <label>Min salary</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="number"
                    style={{ width: 140 }}
                    value={prefs.minSalary ?? ""}
                    onChange={(e) =>
                      setPrefs({ ...prefs, minSalary: e.target.value ? Number(e.target.value) : undefined })
                    }
                  />
                  <select
                    value={prefs.currency ?? "INR"}
                    onChange={(e) => setPrefs({ ...prefs, currency: e.target.value })}
                  >
                    <option value="INR">INR</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="section">
              <h4>Links</h4>
              <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 0 }}>
                Adding these stops Claude from flagging "no portfolio/GitHub" as a con.
              </p>
              <div className="form-grid">
                <label>GitHub</label>
                <input
                  placeholder="https://github.com/yourhandle"
                  value={links.github ?? ""}
                  onChange={(e) => setLinks({ ...links, github: e.target.value })}
                />
                <label>LinkedIn</label>
                <input
                  placeholder="https://www.linkedin.com/in/yourhandle"
                  value={links.linkedin ?? ""}
                  onChange={(e) => setLinks({ ...links, linkedin: e.target.value })}
                />
                <label>Portfolio</label>
                <input
                  placeholder="https://yoursite.dev"
                  value={links.portfolio ?? ""}
                  onChange={(e) => setLinks({ ...links, portfolio: e.target.value })}
                />
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <button className="primary" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save preferences"}
              </button>
              {msg && <span style={{ marginLeft: 12, color: "var(--muted)" }}>{msg}</span>}
            </div>
          </>
        ) : (
          <div className="section">
            <p style={{ color: "var(--muted)" }}>Raw JSON. Fields: name, email, headline, skills[], experience[], education[], links{}, preferences{}, baseResume.</p>
            <textarea value={json} onChange={(e) => setJson(e.target.value)} style={{ minHeight: 500, width: "100%" }} />
            <div style={{ marginTop: 8 }}>
              <button className="primary" onClick={saveJson} disabled={saving}>
                {saving ? "Saving…" : "Save JSON"}
              </button>
              {msg && <span style={{ marginLeft: 12, color: "var(--muted)" }}>{msg}</span>}
            </div>
          </div>
        )}

        <div className="section">
          <h4>Current</h4>
          <div><strong>{profile.name || "(no name)"}</strong> — {profile.headline}</div>
          <div style={{ marginTop: 6 }}>{profile.skills.slice(0, 20).map((s) => <span className="tag" key={s}>{s}</span>)}</div>
        </div>
      </div>
    </>
  );
}
