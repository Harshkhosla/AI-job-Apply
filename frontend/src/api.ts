export interface Job {
  id: string;
  source: string;
  sourceJobId: string;
  url: string;
  company: string;
  title: string;
  location?: string | null;
  remote: boolean;
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
  runs: () => req<any[]>("/api/runs"),
};
