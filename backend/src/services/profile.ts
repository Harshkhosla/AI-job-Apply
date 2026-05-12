import { prisma } from "../db.js";
import type { ProfileData } from "../types.js";

export async function getProfile(): Promise<ProfileData | null> {
  const p = await prisma.profile.findFirst({ orderBy: { createdAt: "asc" } });
  if (!p) return null;
  return {
    name: p.name,
    email: p.email,
    phone: p.phone ?? undefined,
    location: p.location ?? undefined,
    headline: p.headline ?? undefined,
    summary: p.summary ?? undefined,
    skills: safeJSON(p.skills, []),
    experience: safeJSON(p.experience, []),
    education: safeJSON(p.education, []),
    projects: p.projects ? safeJSON(p.projects, []) : undefined,
    certifications: p.certifications ? safeJSON(p.certifications, []) : undefined,
    languages: p.languages ? safeJSON(p.languages, []) : undefined,
    links: p.links ? safeJSON(p.links, {}) : undefined,
    preferences: p.preferences ? safeJSON(p.preferences, {}) : undefined,
    personal: p.personal ? safeJSON(p.personal, {}) : undefined,
    workAuth: p.workAuth ? safeJSON(p.workAuth, {}) : undefined,
    application: p.application ? safeJSON(p.application, {}) : undefined,
    baseResume: p.baseResume ?? undefined,
    resumeFileUrl: p.resumeFileUrl ?? undefined,
  };
}

export async function upsertProfile(data: ProfileData): Promise<void> {
  const existing = await prisma.profile.findFirst();
  const payload = {
    name: data.name,
    email: data.email,
    phone: data.phone,
    location: data.location,
    headline: data.headline,
    summary: data.summary,
    skills: JSON.stringify(data.skills ?? []),
    experience: JSON.stringify(data.experience ?? []),
    education: JSON.stringify(data.education ?? []),
    projects: data.projects ? JSON.stringify(data.projects) : null,
    certifications: data.certifications ? JSON.stringify(data.certifications) : null,
    languages: data.languages ? JSON.stringify(data.languages) : null,
    links: data.links ? JSON.stringify(data.links) : null,
    preferences: data.preferences ? JSON.stringify(data.preferences) : null,
    personal: data.personal ? JSON.stringify(data.personal) : null,
    workAuth: data.workAuth ? JSON.stringify(data.workAuth) : null,
    application: data.application ? JSON.stringify(data.application) : null,
    baseResume: data.baseResume ?? null,
    resumeFileUrl: data.resumeFileUrl ?? null,
  };
  if (existing) {
    await prisma.profile.update({ where: { id: existing.id }, data: payload });
  } else {
    await prisma.profile.create({ data: payload });
  }
}

function safeJSON<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
