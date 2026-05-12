import Anthropic from "@anthropic-ai/sdk";
import type { NormalizedJob, ProfileData, ScoreResult, OutreachResult } from "../types.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Preference order when auto-picking: prefer fastest/cheapest, fall back to bigger.
const MODEL_PREFERENCE = [
  "claude-haiku-4-5-20251001",
  "claude-sonnet-4-6",
  "claude-sonnet-4-5-20250929",
  "claude-sonnet-4-20250514",
  "claude-opus-4-7",
];

let resolvedModel: string | null = null;
let modelResolution: Promise<string> | null = null;

async function resolveModel(): Promise<string> {
  if (resolvedModel) return resolvedModel;
  if (modelResolution) return modelResolution;
  modelResolution = (async () => {
    const envModel = process.env.ANTHROPIC_MODEL?.trim();
    try {
      const list = await (client as any).models.list();
      const available: string[] = (list.data ?? []).map((m: any) => m.id);
      if (envModel && available.includes(envModel)) {
        console.log(`[llm] using model from .env: ${envModel}`);
        return (resolvedModel = envModel);
      }
      if (envModel) {
        console.warn(
          `[llm] ANTHROPIC_MODEL='${envModel}' not available on this key. Available: ${available.join(", ")}`
        );
      }
      const pick =
        MODEL_PREFERENCE.find((m) => available.includes(m)) ?? available[0];
      if (!pick) throw new Error("No Anthropic models available for this API key");
      console.log(`[llm] auto-selected model: ${pick}`);
      return (resolvedModel = pick);
    } catch (e: any) {
      // If model listing fails, fall back to whatever the user set (or a sane default).
      const fallback = envModel || "claude-haiku-4-5-20251001";
      console.warn(`[llm] could not list models (${e?.message ?? e}); using ${fallback}`);
      return (resolvedModel = fallback);
    }
  })();
  return modelResolution;
}

async function callJSON<T>(system: string, user: string, maxTokens = 1500): Promise<T> {
  const model = await resolveModel();
  const res = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  });
  const text = res.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n");
  // Try to extract JSON object/array
  const match = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  const jsonStr = match ? match[1] : text;
  return JSON.parse(jsonStr) as T;
}

async function callText(system: string, user: string, maxTokens = 2000): Promise<string> {
  const model = await resolveModel();
  const res = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  });
  return res.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n")
    .trim();
}

export async function scoreJob(profile: ProfileData, job: NormalizedJob): Promise<ScoreResult> {
  const prefs = profile.preferences ?? {};
  const links = profile.links ?? {};
  const linkLines = [
    links.github && `GitHub: ${links.github}`,
    links.linkedin && `LinkedIn: ${links.linkedin}`,
    links.portfolio && `Portfolio: ${links.portfolio}`,
  ]
    .filter(Boolean)
    .join("\n") || "(none provided)";

  const prefLines = [
    `Target roles: ${(prefs.targetRoles ?? []).join(", ") || "any software engineering"}`,
    `Preferred locations: ${(prefs.locations ?? []).join(", ") || "open"}`,
    `Remote OK: ${prefs.remoteOk ? "yes" : "no/unspecified"}`,
    (prefs as any).onsiteOk != null ? `Onsite OK: ${(prefs as any).onsiteOk ? "yes" : "no"}` : null,
    (prefs as any).hybridOk != null ? `Hybrid OK: ${(prefs as any).hybridOk ? "yes" : "no"}` : null,
    (prefs as any).openToRelocate != null
      ? `Open to relocate: ${(prefs as any).openToRelocate ? "yes" : "no"}`
      : null,
    (prefs as any).visaSponsorship != null
      ? `Needs visa sponsorship: ${(prefs as any).visaSponsorship ? "yes" : "no"}`
      : null,
    (prefs as any).yearsExperience != null
      ? `Years of experience: ${(prefs as any).yearsExperience}`
      : null,
    (prefs as any).seniorityTarget
      ? `Seniority target: ${(prefs as any).seniorityTarget}`
      : null,
    prefs.minSalary
      ? `Min salary: ${prefs.minSalary} ${prefs.currency ?? ""}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const system =
    "You are an expert technical recruiter. Score how well a candidate matches a job (0-100). " +
    "Return STRICT JSON only: {\"score\": number 0-100, \"fitSummary\": string, \"pros\": string[], \"cons\": string[]}.\n" +
    "\nScoring rubric (sum the components, then return ONE final score):\n" +
    "- Skills overlap (0-35): how many required skills the candidate has, weighted by importance.\n" +
    "- Seniority/title match (0-20): title and required years vs candidate's experience.\n" +
    "- Domain/stack relevance (0-15): MERN, Next.js, TypeScript, AI/LLM, cloud, etc.\n" +
    "- Location/work-mode compatibility (0-15): respect the candidate's stated preferences. " +
    "If candidate is remote-OK and job is remote, award full points. " +
    "If candidate is open-to-relocate and job is onsite in another city, award most points. " +
    "Only penalize if the job's location/mode is explicitly incompatible with ALL the candidate's accepted modes.\n" +
    "- Comp & growth (0-15): if salary disclosed and below candidate's min, penalize; otherwise neutral-to-positive.\n" +
    "\nIMPORTANT GUIDANCE:\n" +
    "1. Do NOT list 'no portfolio/GitHub/LinkedIn' as a con if links are provided below.\n" +
    "2. Do NOT mark down for missing info you weren't given — focus on actual signal in the resume.\n" +
    "3. If location seems mismatched but candidate is open to remote/relocate, mention it neutrally, don't penalize harshly.\n" +
    "4. Keep fitSummary to ONE sentence. Pros/cons max 4 each, each a short phrase.";

  const user = `CANDIDATE PROFILE:
Name: ${profile.name}
Headline: ${profile.headline ?? ""}
Location: ${profile.location ?? "n/a"}
Summary: ${profile.summary ?? ""}
Skills: ${(profile.skills ?? []).join(", ")}
Experience: ${JSON.stringify(profile.experience ?? [], null, 2)}
Education: ${JSON.stringify(profile.education ?? [], null, 2)}
Links:
${linkLines}

PREFERENCES (use these to judge location/mode/comp fit):
${prefLines}

JOB:
Company: ${job.company}
Title: ${job.title}
Location: ${job.location ?? "n/a"} (remote flag: ${job.remote ?? false})
${job.salaryMin || job.salaryMax ? `Salary: ${job.salaryMin ?? "?"}-${job.salaryMax ?? "?"} ${job.currency ?? ""}` : ""}
Description:
${job.description.slice(0, 6000)}

Return JSON only.`;
  return callJSON<ScoreResult>(system, user, 800);
}

export async function tailorResume(profile: ProfileData, job: NormalizedJob): Promise<string> {
  const system =
    "You are an elite resume writer. Tailor the candidate's master resume for a specific job. " +
    "Keep it truthful — never invent experience. Reorder, rephrase, and emphasize the most relevant work. " +
    "Output clean Markdown only (no preamble).";
  const user = `MASTER RESUME / PROFILE:\n${profile.baseResume ?? JSON.stringify(profile, null, 2)}\n\nTARGET JOB:\nCompany: ${job.company}\nTitle: ${job.title}\nDescription:\n${job.description.slice(0, 6000)}`;
  return callText(system, user, 2500);
}

export async function generateOutreach(
  profile: ProfileData,
  job: NormalizedJob,
  recruiterName?: string
): Promise<OutreachResult> {
  const system =
    "You write concise, high-signal recruiter outreach messages for software engineers. " +
    "Return STRICT JSON only: {\"subject\": string, \"body\": string, \"recruiter\": string?}. " +
    "Tone: warm, confident, specific. 120-180 words. Mention 1-2 concrete reasons of fit. No fluff.";
  const user = `CANDIDATE: ${profile.name} — ${profile.headline ?? ""}\nLinks: ${JSON.stringify(profile.links ?? {})}\nTop skills: ${profile.skills.slice(0, 12).join(", ")}\n\nJOB:\nCompany: ${job.company}\nTitle: ${job.title}\nURL: ${job.url}\nDescription excerpt:\n${job.description.slice(0, 3000)}\n\nRecruiter name (if known): ${recruiterName ?? "unknown"}\n\nReturn JSON only.`;
  return callJSON<OutreachResult>(system, user, 800);
}
