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
    links: p.links ? safeJSON(p.links, {}) : undefined,
    preferences: p.preferences ? safeJSON(p.preferences, {}) : undefined,
    baseResume: p.baseResume ?? undefined,
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
    links: data.links ? JSON.stringify(data.links) : null,
    preferences: data.preferences ? JSON.stringify(data.preferences) : null,
    baseResume: data.baseResume ?? null,
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
