import { useState } from "react";
import JobsView from "./components/JobsView";
import IngestView from "./components/IngestView";
import ProfileView from "./components/ProfileView";
import ApplicationsView from "./components/ApplicationsView";
import FindJobsView from "./components/FindJobsView";

type View = "find" | "jobs" | "applications" | "ingest" | "profile";

export interface JobsPreset {
  source?: string;
  hours?: string;
  q?: string;
}

export default function App() {
  const [view, setView] = useState<View>("find");
  const [jobsPreset, setJobsPreset] = useState<JobsPreset | undefined>(undefined);

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>AI Job Hunter</h1>
        <div className="nav">
          <button
            className={view === "find" ? "active" : ""}
            onClick={() => setView("find")}
          >
            Find Jobs
          </button>
          <button
            className={view === "jobs" ? "active" : ""}
            onClick={() => {
              setJobsPreset(undefined);
              setView("jobs");
            }}
          >
            All Jobs
          </button>
          <button
            className={view === "applications" ? "active" : ""}
            onClick={() => setView("applications")}
          >
            Applications
          </button>
          <button
            className={view === "ingest" ? "active" : ""}
            onClick={() => setView("ingest")}
          >
            Ingest (advanced)
          </button>
          <button
            className={view === "profile" ? "active" : ""}
            onClick={() => setView("profile")}
          >
            Profile
          </button>
        </div>
        <h3>About</h3>
        <p style={{ fontSize: 12, color: "var(--muted)" }}>
          Find, score, and tailor applications for software roles using Claude.
        </p>
      </aside>
      <main className="main">
        {view === "find" && (
          <FindJobsView
            onDone={(filters) => {
              setJobsPreset(filters);
              setView("jobs");
            }}
          />
        )}
        {view === "jobs" && <JobsView preset={jobsPreset} />}
        {view === "applications" && <ApplicationsView />}
        {view === "ingest" && <IngestView />}
        {view === "profile" && <ProfileView />}
      </main>
    </div>
  );
}
