export interface Job {
  id: string;
  source: string;
  sourceJobId: string;
  url: string;
  company: string;
  title: string;
  location?: string | null;
  remote: boolean;
  easyApply?: boolean;
  employmentType?: string | null;
  description: string;
  salaryMin?: number | null;
  salaryMax?: number | null;
  currency?: string | null;
  postedAt?: string | null;
  fetchedAt: string;
  score?: number | null;
  scoreReason?: string | null;
  tailoredResume?: string | null;
  outreach?: string | null;
  status: string;
  notes?: string | null;
}

export interface Profile {
  name: string;
  email: string;
  phone?: string;
  location?: string;
  headline?: string;
  summary?: string;
  skills: string[];
  experience: any[];
  education: any[];
  projects?: any[];
  certifications?: any[];
  languages?: any[];
  links?: {
    github?: string;
    linkedin?: string;
    portfolio?: string;
    twitter?: string;
    stackoverflow?: string;
    leetcode?: string;
    medium?: string;
  };
  preferences?: any;
  personal?: any;
  workAuth?: any;
  application?: any;
  baseResume?: string;
  resumeFileUrl?: string;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}

export const api = {
  health: () => req<{ ok: boolean }>("/api/health"),
  listJobs: (params: Record<string, string> = {}) => {
    const q = new URLSearchParams(params).toString();
    return req<{ total: number; page: number; pageSize: number; jobs: Job[] }>(
      `/api/jobs${q ? "?" + q : ""}`
    );
  },
  getJob: (id: string) => req<Job>(`/api/jobs/${id}`),
  updateJob: (id: string, body: Partial<{ status: string; notes: string }>) =>
    req<Job>(`/api/jobs/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  resetScores: () =>
    req<{ cleared: number }>("/api/jobs/reset-scores", { method: "POST" }),
  ingest: (body: { source: string; query: string; location?: string; pages?: number }) =>
    req<{ inserted: number; total: number }>("/api/ingest", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  ingestAll: (body: { hours?: number; sources?: string[] } = {}) =>
    req<{
      totalCompanies: number;
      totalJobs: number;
      inserted: number;
      kept: number;
      errors: Array<{ source: string; company: string; error: string }>;
    }>("/api/ingest-all", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  score: (id: string) => req(`/api/jobs/${id}/score`, { method: "POST" }),
  resume: (id: string) => req<{ resume: string }>(`/api/jobs/${id}/resume`, { method: "POST" }),
  outreach: (id: string, recruiterName?: string) =>
    req<{ subject: string; body: string }>(`/api/jobs/${id}/outreach`, {
      method: "POST",
      body: JSON.stringify({ recruiterName }),
    }),
  scoreBatch: (body: {
    limit?: number;
    status?: string;
    source?: string;
    q?: string;
    hours?: number;
    onlyUnscored?: boolean;
    ids?: string[];
  } = {}) =>
    req<{
      scored: number;
      failed: number;
      results: Array<{ id: string; score?: number; error?: string }>;
    }>("/api/score-batch", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getProfile: () => req<Profile | null>("/api/profile"),
  saveProfile: (p: Profile) =>
    req<{ ok: boolean }>("/api/profile", { method: "PUT", body: JSON.stringify(p) }),
  uploadResume: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const r = await fetch("/api/profile/resume", { method: "POST", body: form });
    if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
    return r.json() as Promise<{ url: string; filename: string }>;
  },
  runs: () => req<any[]>("/api/runs"),

  // Auto-apply
  planApplication: (jobId: string, withCoverLetter = false) =>
    req<any>(`/api/jobs/${jobId}/apply/plan`, {
      method: "POST",
      body: JSON.stringify({ withCoverLetter }),
    }),
  getApplication: (jobId: string) => req<any | null>(`/api/jobs/${jobId}/apply`),
  updateField: (applicationId: string, fieldId: string, value: any) =>
    req<any>(
      `/api/applications/${applicationId}/fields/${encodeURIComponent(fieldId)}`,
      { method: "PATCH", body: JSON.stringify({ value }) }
    ),
  listApplications: (status?: string) =>
    req<any[]>(`/api/applications${status ? `?status=${status}` : ""}`),
  submitApplication: (id: string, dryRun = true) =>
    req<any>(`/api/applications/${id}/submit`, {
      method: "POST",
      body: JSON.stringify({ dryRun }),
    }),
  getAutoApplySettings: () => req<any>("/api/settings/auto-apply"),
  saveAutoApplySettings: (p: any) =>
    req<any>("/api/settings/auto-apply", { method: "PUT", body: JSON.stringify(p) }),

  fillLinkedIn: (applicationId: string) =>
    req<{ filled: string[]; skipped: { id: string; reason: string }[]; reviewUrl: string }>(
      `/api/applications/${applicationId}/fill-linkedin`,
      { method: "POST" }
    ),
  fillApplication: (applicationId: string) =>
    req<{ filled: string[]; skipped: { id: string; reason: string }[]; reviewUrl: string }>(
      `/api/applications/${applicationId}/fill`,
      { method: "POST" }
    ),
  closeLinkedInBrowser: () =>
    req<{ ok: boolean }>("/api/linkedin/close", { method: "POST" }),

  // Batch apply
  startBatch: (jobIds: string[], autoAdvanceSeconds?: number) =>
    req<any>("/api/batch", {
      method: "POST",
      body: JSON.stringify({ jobIds, autoAdvanceSeconds }),
    }),
  getBatch: (id: string) => req<any>(`/api/batch/${id}`),
  nextBatch: (id: string) => req<{ ok: boolean }>(`/api/batch/${id}/next`, { method: "POST" }),
  cancelBatch: (id: string) =>
    req<{ ok: boolean }>(`/api/batch/${id}/cancel`, { method: "POST" }),
};
