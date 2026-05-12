import { useEffect, useState } from "react";
import { api, type Profile } from "../api";

const EMPTY: Profile = {
  name: "",
  email: "",
  skills: [],
  experience: [],
  education: [],
};

type Tab = "basics" | "preferences" | "personal" | "workAuth" | "application" | "links" | "advanced";

export default function ProfileView() {
  const [profile, setProfile] = useState<Profile>(EMPTY);
  const [tab, setTab] = useState<Tab>("basics");
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
      await api.saveProfile(profile);
      setJson(JSON.stringify(profile, null, 2));
      setMsg("Saved. Tip: re-score jobs to see updated fit.");
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
      setMsg("Saved.");
    } catch (e: any) {
      setMsg(`Error: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  // Helper setters for nested objects
  const upd = (patch: Partial<Profile>) => setProfile({ ...profile, ...patch });
  const updNested = <K extends keyof Profile>(key: K, patch: any) =>
    setProfile({ ...profile, [key]: { ...(profile[key] as any), ...patch } } as Profile);

  const tabs: { id: Tab; label: string }[] = [
    { id: "basics", label: "Basics" },
    { id: "preferences", label: "Preferences" },
    { id: "personal", label: "Personal" },
    { id: "workAuth", label: "Work Auth" },
    { id: "application", label: "Application" },
    { id: "links", label: "Links" },
    { id: "advanced", label: "Advanced (JSON)" },
  ];

  return (
    <>
      <div className="toolbar">
        <strong>Profile</strong>
        <span style={{ color: "var(--muted)", fontSize: 12 }}>
          Powers scoring, resume tailoring, and (later) auto-apply form filling.
        </span>
        <button
          className="primary"
          onClick={tab === "advanced" ? saveJson : save}
          disabled={saving}
          style={{ marginLeft: "auto" }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {msg && <span style={{ color: "var(--muted)", fontSize: 12 }}>{msg}</span>}
      </div>

      <div style={{ display: "flex", gap: 4, padding: "0 16px", borderBottom: "1px solid var(--border)", background: "var(--panel)" }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              border: "none",
              background: "transparent",
              padding: "10px 14px",
              borderBottom: tab === t.id ? "2px solid var(--accent)" : "2px solid transparent",
              color: tab === t.id ? "var(--text)" : "var(--muted)",
              borderRadius: 0,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="content">
        {tab === "basics" && <BasicsTab profile={profile} upd={upd} />}
        {tab === "preferences" && <PreferencesTab profile={profile} updNested={updNested} />}
        {tab === "personal" && <PersonalTab profile={profile} updNested={updNested} />}
        {tab === "workAuth" && <WorkAuthTab profile={profile} updNested={updNested} />}
        {tab === "application" && <ApplicationTab profile={profile} updNested={updNested} />}
        {tab === "links" && <LinksTab profile={profile} updNested={updNested} />}
        {tab === "advanced" && (
          <div className="section">
            <p style={{ color: "var(--muted)" }}>Raw JSON — all fields.</p>
            <textarea
              value={json}
              onChange={(e) => setJson(e.target.value)}
              style={{ minHeight: 500, width: "100%" }}
            />
          </div>
        )}
      </div>
    </>
  );
}

/* ---------- Tab components ---------- */

function BasicsTab({ profile, upd }: { profile: Profile; upd: (p: Partial<Profile>) => void }) {
  return (
    <div className="section">
      <h4>Basics</h4>
      <div className="form-grid">
        <label>Full name</label>
        <input value={profile.name} onChange={(e) => upd({ name: e.target.value })} />
        <label>Email</label>
        <input value={profile.email} onChange={(e) => upd({ email: e.target.value })} />
        <label>Phone</label>
        <input value={profile.phone ?? ""} onChange={(e) => upd({ phone: e.target.value })} />
        <label>Current location</label>
        <input value={profile.location ?? ""} onChange={(e) => upd({ location: e.target.value })} />
        <label>Headline</label>
        <input value={profile.headline ?? ""} onChange={(e) => upd({ headline: e.target.value })} />
        <label>Summary</label>
        <textarea
          style={{ minHeight: 100 }}
          value={profile.summary ?? ""}
          onChange={(e) => upd({ summary: e.target.value })}
        />
        <label>Skills (comma-sep)</label>
        <textarea
          style={{ minHeight: 80 }}
          value={(profile.skills ?? []).join(", ")}
          onChange={(e) =>
            upd({ skills: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })
          }
        />
      </div>
    </div>
  );
}

function PreferencesTab({
  profile,
  updNested,
}: {
  profile: Profile;
  updNested: (k: keyof Profile, patch: any) => void;
}) {
  const p = profile.preferences ?? {};
  const set = (patch: any) => updNested("preferences", patch);
  return (
    <>
      <div className="section">
        <h4>Work setup</h4>
        <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 0 }}>
          These directly affect your fit score.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
          <Check label="Open to remote" checked={!!p.remoteOk} onChange={(v) => set({ remoteOk: v })} />
          <Check label="Open to onsite" checked={!!p.onsiteOk} onChange={(v) => set({ onsiteOk: v })} />
          <Check label="Open to hybrid" checked={!!p.hybridOk} onChange={(v) => set({ hybridOk: v })} />
          <Check label="Open to relocation" checked={!!p.openToRelocate} onChange={(v) => set({ openToRelocate: v })} />
          <Check label="Needs visa sponsorship" checked={!!p.visaSponsorship} onChange={(v) => set({ visaSponsorship: v })} />
        </div>
      </div>
      <div className="section">
        <h4>Targets</h4>
        <div className="form-grid">
          <label>Target roles</label>
          <input
            placeholder="Full Stack Engineer, SDE, AI Engineer"
            value={(p.targetRoles ?? []).join(", ")}
            onChange={(e) =>
              set({ targetRoles: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean) })
            }
          />
          <label>Preferred locations</label>
          <input
            placeholder="Bengaluru, Remote, San Francisco"
            value={(p.locations ?? []).join(", ")}
            onChange={(e) =>
              set({ locations: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean) })
            }
          />
          <label>Years of experience</label>
          <input
            type="number"
            style={{ width: 100 }}
            value={p.yearsExperience ?? ""}
            onChange={(e) =>
              set({ yearsExperience: e.target.value ? Number(e.target.value) : undefined })
            }
          />
          <label>Seniority target</label>
          <select value={p.seniorityTarget ?? ""} onChange={(e) => set({ seniorityTarget: e.target.value || undefined })}>
            <option value="">(any)</option>
            <option value="Intern">Intern</option>
            <option value="New Grad / Junior">New Grad / Junior</option>
            <option value="Mid-level (SDE 1-2)">Mid-level (SDE 1-2)</option>
            <option value="Senior">Senior</option>
            <option value="Staff+">Staff+</option>
          </select>
          <label>Employment types</label>
          <input
            placeholder="Full-time, Contract, Internship"
            value={(p.employmentTypes ?? []).join(", ")}
            onChange={(e) =>
              set({ employmentTypes: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean) })
            }
          />
          <label>Industries</label>
          <input
            placeholder="Fintech, AI/ML, SaaS"
            value={(p.industries ?? []).join(", ")}
            onChange={(e) =>
              set({ industries: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean) })
            }
          />
          <label>Avoid companies</label>
          <input
            placeholder="(comma-sep slugs)"
            value={(p.avoidCompanies ?? []).join(", ")}
            onChange={(e) =>
              set({ avoidCompanies: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean) })
            }
          />
          <label>Min salary</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="number"
              style={{ width: 140 }}
              value={p.minSalary ?? ""}
              onChange={(e) => set({ minSalary: e.target.value ? Number(e.target.value) : undefined })}
            />
            <select value={p.currency ?? "INR"} onChange={(e) => set({ currency: e.target.value })}>
              <option value="INR">INR</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
            </select>
          </div>
        </div>
      </div>
    </>
  );
}

function PersonalTab({
  profile,
  updNested,
}: {
  profile: Profile;
  updNested: (k: keyof Profile, patch: any) => void;
}) {
  const p = profile.personal ?? {};
  const set = (patch: any) => updNested("personal", patch);
  return (
    <div className="section">
      <h4>Personal details</h4>
      <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 0 }}>
        Used for auto-filling application forms (Greenhouse, Lever, Workday). EEO fields are optional.
      </p>
      <div className="form-grid">
        <label>First name</label>
        <input value={p.firstName ?? ""} onChange={(e) => set({ firstName: e.target.value })} />
        <label>Last name</label>
        <input value={p.lastName ?? ""} onChange={(e) => set({ lastName: e.target.value })} />
        <label>Preferred name</label>
        <input value={p.preferredName ?? ""} onChange={(e) => set({ preferredName: e.target.value })} />
        <label>Pronouns</label>
        <input placeholder="he/him, she/her, they/them" value={p.pronouns ?? ""} onChange={(e) => set({ pronouns: e.target.value })} />
        <label>Address line 1</label>
        <input value={p.addressLine1 ?? ""} onChange={(e) => set({ addressLine1: e.target.value })} />
        <label>Address line 2</label>
        <input value={p.addressLine2 ?? ""} onChange={(e) => set({ addressLine2: e.target.value })} />
        <label>City</label>
        <input value={p.city ?? ""} onChange={(e) => set({ city: e.target.value })} />
        <label>State / region</label>
        <input value={p.state ?? ""} onChange={(e) => set({ state: e.target.value })} />
        <label>Postal code</label>
        <input value={p.postalCode ?? ""} onChange={(e) => set({ postalCode: e.target.value })} />
        <label>Country</label>
        <input value={p.country ?? ""} onChange={(e) => set({ country: e.target.value })} />
        <label>Date of birth</label>
        <input type="date" value={p.dateOfBirth ?? ""} onChange={(e) => set({ dateOfBirth: e.target.value })} />
        <label>Gender (EEO)</label>
        <select value={p.gender ?? ""} onChange={(e) => set({ gender: e.target.value })}>
          <option value="">(prefer not to say)</option>
          <option>Male</option>
          <option>Female</option>
          <option>Non-binary</option>
          <option>Other</option>
        </select>
        <label>Race (EEO, US)</label>
        <input value={p.race ?? ""} onChange={(e) => set({ race: e.target.value })} />
        <label>Veteran status (US)</label>
        <select value={p.veteranStatus ?? ""} onChange={(e) => set({ veteranStatus: e.target.value })}>
          <option value="">(prefer not to say)</option>
          <option>I am not a veteran</option>
          <option>I am a veteran</option>
        </select>
        <label>Disability status</label>
        <select value={p.disabilityStatus ?? ""} onChange={(e) => set({ disabilityStatus: e.target.value })}>
          <option value="">(prefer not to say)</option>
          <option>No, I do not have a disability</option>
          <option>Yes, I have a disability</option>
        </select>
      </div>
    </div>
  );
}

function WorkAuthTab({
  profile,
  updNested,
}: {
  profile: Profile;
  updNested: (k: keyof Profile, patch: any) => void;
}) {
  const w = profile.workAuth ?? {};
  const set = (patch: any) => updNested("workAuth", patch);
  return (
    <div className="section">
      <h4>Work authorization</h4>
      <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 0 }}>
        Helps the scorer judge fit & prefills the most common application gating questions.
      </p>
      <div className="form-grid">
        <label>Citizen of</label>
        <input placeholder="India" value={w.citizenOf ?? ""} onChange={(e) => set({ citizenOf: e.target.value })} />
        <label>Authorized to work in</label>
        <input
          placeholder="India, US (OPT), UK"
          value={(w.authorizedToWorkIn ?? []).join(", ")}
          onChange={(e) =>
            set({
              authorizedToWorkIn: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean),
            })
          }
        />
        <label>Needs sponsorship in</label>
        <input
          placeholder="US, UK, Canada"
          value={(w.needsSponsorshipIn ?? []).join(", ")}
          onChange={(e) =>
            set({
              needsSponsorshipIn: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean),
            })
          }
        />
        <label>Visa status</label>
        <input placeholder="None / H1B / F1-OPT / EAD" value={w.visaStatus ?? ""} onChange={(e) => set({ visaStatus: e.target.value })} />
        <label>Relocation assistance</label>
        <label style={{ paddingTop: 8 }}>
          <input
            type="checkbox"
            checked={!!w.requiresRelocationAssistance}
            onChange={(e) => set({ requiresRelocationAssistance: e.target.checked })}
          />{" "}
          I'd need relocation assistance
        </label>
      </div>
    </div>
  );
}

function ApplicationTab({
  profile,
  updNested,
}: {
  profile: Profile;
  updNested: (k: keyof Profile, patch: any) => void;
}) {
  const a = profile.application ?? {};
  const set = (patch: any) => updNested("application", patch);
  return (
    <>
      <div className="section">
        <h4>Application defaults</h4>
        <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 0 }}>
          These get pre-filled when auto-applying (next phase).
        </p>
        <div className="form-grid">
          <label>Notice period (days)</label>
          <input
            type="number"
            style={{ width: 120 }}
            value={a.noticePeriodDays ?? ""}
            onChange={(e) => set({ noticePeriodDays: e.target.value ? Number(e.target.value) : undefined })}
          />
          <label>Current salary</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="number"
              style={{ width: 140 }}
              value={a.currentSalary ?? ""}
              onChange={(e) => set({ currentSalary: e.target.value ? Number(e.target.value) : undefined })}
            />
            <select
              value={a.currentSalaryCurrency ?? "INR"}
              onChange={(e) => set({ currentSalaryCurrency: e.target.value })}
            >
              <option>INR</option><option>USD</option><option>EUR</option><option>GBP</option>
            </select>
          </div>
          <label>Expected salary</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="number"
              style={{ width: 140 }}
              value={a.expectedSalary ?? ""}
              onChange={(e) => set({ expectedSalary: e.target.value ? Number(e.target.value) : undefined })}
            />
            <select
              value={a.expectedSalaryCurrency ?? "INR"}
              onChange={(e) => set({ expectedSalaryCurrency: e.target.value })}
            >
              <option>INR</option><option>USD</option><option>EUR</option><option>GBP</option>
            </select>
          </div>
          <label>Available from</label>
          <input type="date" value={a.availabilityDate ?? ""} onChange={(e) => set({ availabilityDate: e.target.value })} />
          <label>Referred by</label>
          <input value={a.referredBy ?? ""} onChange={(e) => set({ referredBy: e.target.value })} />
          <label>Cover letter snippet</label>
          <textarea
            style={{ minHeight: 100 }}
            placeholder="A reusable 2-3 sentence pitch about you. Claude can extend this per job."
            value={a.coverLetterSnippet ?? ""}
            onChange={(e) => set({ coverLetterSnippet: e.target.value })}
          />
          <label>"Why this company?" template</label>
          <textarea
            style={{ minHeight: 80 }}
            placeholder="What generally attracts you to a company (product, tech, mission). Claude will personalize."
            value={a.whyThisCompany ?? ""}
            onChange={(e) => set({ whyThisCompany: e.target.value })}
          />
        </div>
      </div>
    </>
  );
}

function LinksTab({
  profile,
  updNested,
}: {
  profile: Profile;
  updNested: (k: keyof Profile, patch: any) => void;
}) {
  const l = profile.links ?? {};
  const set = (patch: any) => updNested("links", patch);
  return (
    <div className="section">
      <h4>Links</h4>
      <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 0 }}>
        Adding these stops Claude from flagging "no portfolio/GitHub" as a con.
      </p>
      <div className="form-grid">
        <label>GitHub</label>
        <input value={l.github ?? ""} onChange={(e) => set({ github: e.target.value })} placeholder="https://github.com/…" />
        <label>LinkedIn</label>
        <input value={l.linkedin ?? ""} onChange={(e) => set({ linkedin: e.target.value })} placeholder="https://linkedin.com/in/…" />
        <label>Portfolio</label>
        <input value={l.portfolio ?? ""} onChange={(e) => set({ portfolio: e.target.value })} placeholder="https://yoursite.dev" />
        <label>Twitter / X</label>
        <input value={l.twitter ?? ""} onChange={(e) => set({ twitter: e.target.value })} />
        <label>Stack Overflow</label>
        <input value={l.stackoverflow ?? ""} onChange={(e) => set({ stackoverflow: e.target.value })} />
        <label>LeetCode</label>
        <input value={l.leetcode ?? ""} onChange={(e) => set({ leetcode: e.target.value })} />
        <label>Medium / blog</label>
        <input value={l.medium ?? ""} onChange={(e) => set({ medium: e.target.value })} />
      </div>
    </div>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}
