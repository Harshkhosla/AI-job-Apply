import { useState } from "react";
import JobsView from "./components/JobsView";
import IngestView from "./components/IngestView";
import ProfileView from "./components/ProfileView";
import ApplicationsView from "./components/ApplicationsView";

type View = "jobs" | "applications" | "ingest" | "profile";

export default function App() {
  const [view, setView] = useState<View>("jobs");

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>AI Job Hunter</h1>
        <div className="nav">
          <button
            className={view === "jobs" ? "active" : ""}
            onClick={() => setView("jobs")}
          >
            Jobs
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
            Ingest
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
        {view === "jobs" && <JobsView />}
        {view === "applications" && <ApplicationsView />}
        {view === "ingest" && <IngestView />}
        {view === "profile" && <ProfileView />}
      </main>
    </div>
  );
}
