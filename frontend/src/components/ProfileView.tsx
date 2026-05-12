import { useEffect, useState } from "react";
import { api, type Profile } from "../api";

const EMPTY: Profile = {
  name: "", email: "", skills: [], experience: [], education: [],
};

export default function ProfileView() {
  const [profile, setProfile] = useState<Profile>(EMPTY);
  const [json, setJson] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    api.getProfile().then((p) => {
      if (p) {
        setProfile(p);
        setJson(JSON.stringify(p, null, 2));
      }
    });
  }, []);

  async function save() {
    setSaving(true);
    setMsg("");
    try {
      const parsed = JSON.parse(json) as Profile;
      await api.saveProfile(parsed);
      setProfile(parsed);
      setMsg("Saved.");
    } catch (e: any) {
      setMsg(`Error: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="toolbar">
        <strong>Profile</strong>
        <span style={{ color: "var(--muted)", fontSize: 12 }}>
          Used by Claude to score jobs and tailor resumes.
        </span>
      </div>
      <div className="content">
        <div className="section">
          <p style={{ color: "var(--muted)" }}>
            Edit the JSON below. Fields: name, email, headline, summary, skills[], experience[], education[],
            links{}, preferences{}, baseResume (markdown).
          </p>
          <textarea
            value={json}
            onChange={(e) => setJson(e.target.value)}
            style={{ minHeight: 500, width: "100%" }}
          />
          <div style={{ marginTop: 8 }}>
            <button className="primary" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            {msg && <span style={{ marginLeft: 12, color: "var(--muted)" }}>{msg}</span>}
          </div>
        </div>
        <div className="section">
          <h4>Current</h4>
          <div><strong>{profile.name || "(no name)"}</strong> — {profile.headline}</div>
          <div style={{ marginTop: 6 }}>{profile.skills.map((s) => <span className="tag" key={s}>{s}</span>)}</div>
        </div>
      </div>
    </>
  );
}
