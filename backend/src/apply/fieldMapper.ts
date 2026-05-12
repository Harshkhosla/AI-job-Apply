import type { FieldPlan, FormField, ParsedForm, PlannedField } from "./types.js";
import type { ProfileData } from "../types.js";
import { answerFormField } from "../llm/claude.js";

/**
 * Produce a FieldPlan from a ParsedForm + Profile.
 * Strategy: deterministic heuristics first, Claude fallback per ambiguous field.
 */
export async function buildFieldPlan(
  form: ParsedForm,
  profile: ProfileData,
  context: { jobTitle: string; jobCompany: string; jobDescription: string }
): Promise<FieldPlan> {
  const planned: PlannedField[] = [];
  const warnings: string[] = [];

  for (const field of form.fields) {
    const direct = matchHeuristic(field, profile);
    if (direct) {
      planned.push(direct);
      continue;
    }
    // For file fields the user must upload separately; flag as missing.
    if (field.type === "file") {
      planned.push({
        id: field.id,
        label: field.label,
        type: field.type,
        value: profile.resumeFileUrl ?? null,
        source: profile.resumeFileUrl ? "profile" : "missing",
        confidence: profile.resumeFileUrl ? 1 : 0,
        required: field.required,
        reason: profile.resumeFileUrl
          ? "Resume on file"
          : "Upload a PDF resume in Profile › Application to fill file fields automatically",
      });
      continue;
    }
    // Skill-mismatch fields, EEO, custom Qs → ask Claude.
    try {
      const llm = await answerFormField({
        field,
        profile,
        context,
      });
      planned.push({
        id: field.id,
        label: field.label,
        type: field.type,
        value: llm.value,
        source: "llm",
        confidence: llm.confidence,
        required: field.required,
        reason: llm.reason,
      });
    } catch (e: any) {
      planned.push({
        id: field.id,
        label: field.label,
        type: field.type,
        value: null,
        source: "missing",
        confidence: 0,
        required: field.required,
        reason: `LLM error: ${e?.message ?? e}`,
      });
    }
  }

  const unresolved = planned.filter(
    (p) =>
      p.required &&
      (p.value === null || p.value === undefined || p.value === "" || p.confidence < 0.6)
  );

  return { fields: planned, unresolved, warnings };
}

/* ---------- heuristic matchers ---------- */

function matchHeuristic(field: FormField, profile: ProfileData): PlannedField | null {
  const L = field.label.toLowerCase();
  const id = field.id.toLowerCase();
  const personal = profile.personal ?? {};
  const links = profile.links ?? {};
  const app = profile.application ?? {};
  const auth = profile.workAuth ?? {};
  const prefs = profile.preferences ?? {};

  const set = (value: any, conf = 0.95, reason = "Direct match"): PlannedField => ({
    id: field.id,
    label: field.label,
    type: field.type,
    value,
    source: "profile",
    confidence: conf,
    required: field.required,
    reason,
  });

  // Identity
  if (matches(L, id, ["first name"])) return set(personal.firstName ?? splitName(profile.name).first);
  if (matches(L, id, ["last name", "surname", "family name"])) return set(personal.lastName ?? splitName(profile.name).last);
  if (matches(L, id, ["preferred name", "nickname"])) return set(personal.preferredName ?? splitName(profile.name).first);
  if (matches(L, id, ["full name", "name"]) && !L.includes("company")) return set(profile.name);
  if (matches(L, id, ["pronoun"])) return set(personal.pronouns ?? "");

  // Contact
  if (field.type === "email" || matches(L, id, ["email"])) return set(profile.email);
  if (field.type === "phone" || matches(L, id, ["phone", "mobile", "cell"])) return set(profile.phone ?? "");

  // Address
  if (matches(L, id, ["address line 1", "street"])) return set(personal.addressLine1 ?? "");
  if (matches(L, id, ["address line 2"])) return set(personal.addressLine2 ?? "");
  if (matches(L, id, ["city"])) return set(personal.city ?? "");
  if (matches(L, id, ["state", "province", "region"])) return set(personal.state ?? "");
  if (matches(L, id, ["postal code", "zip"])) return set(personal.postalCode ?? "");
  if (matches(L, id, ["country"])) return set(personal.country ?? "");
  if (matches(L, id, ["location", "current location"]) && field.type !== "select")
    return set(profile.location ?? "");

  // Links
  if (matches(L, id, ["linkedin"])) return set(links.linkedin ?? "");
  if (matches(L, id, ["github"])) return set(links.github ?? "");
  if (matches(L, id, ["portfolio", "website", "personal site"])) return set(links.portfolio ?? "");
  if (matches(L, id, ["twitter", " x "])) return set(links.twitter ?? "");

  // Work auth
  if (matches(L, id, ["authorized to work", "work authorization", "authorisation"])) {
    const yes = (auth.authorizedToWorkIn ?? []).length > 0;
    return set(toYesNo(field, yes), 0.85, "From workAuth");
  }
  if (matches(L, id, ["sponsorship", "require sponsorship", "need sponsorship", "visa support"])) {
    const needs = (auth.needsSponsorshipIn ?? []).length > 0;
    return set(toYesNo(field, needs), 0.85, "From workAuth");
  }
  if (matches(L, id, ["citizen", "citizenship", "nationality"])) return set(auth.citizenOf ?? "");
  if (matches(L, id, ["visa status"])) return set(auth.visaStatus ?? "");

  // Comp & timing
  if (matches(L, id, ["notice period"])) return set(app.noticePeriodDays ?? "");
  if (matches(L, id, ["expected salary", "salary expectation", "desired comp"]))
    return set(app.expectedSalary ?? prefs.minSalary ?? "");
  if (matches(L, id, ["current salary", "current ctc"]))
    return set(app.currentSalary ?? "");
  if (matches(L, id, ["available", "start date", "earliest start"]))
    return set(app.availabilityDate ?? "");
  if (matches(L, id, ["referred by", "referral"])) return set(app.referredBy ?? "");

  // Relocation / remote
  if (matches(L, id, ["willing to relocate", "open to relocate"])) {
    return set(toYesNo(field, !!prefs.openToRelocate), 0.85);
  }
  if (matches(L, id, ["remote", "work from home"])) {
    return set(toYesNo(field, !!prefs.remoteOk), 0.85);
  }

  // EEO — only fill if the user populated personal info.
  if (matches(L, id, ["gender"]) && personal.gender) return set(personal.gender, 0.9, "EEO");
  if (matches(L, id, ["race", "ethnicity"]) && personal.race) return set(personal.race, 0.9, "EEO");
  if (matches(L, id, ["veteran"]) && personal.veteranStatus) return set(personal.veteranStatus, 0.9, "EEO");
  if (matches(L, id, ["disability"]) && personal.disabilityStatus) return set(personal.disabilityStatus, 0.9, "EEO");

  // Education quickies
  if (matches(L, id, ["school", "university"])) return set(profile.education[0]?.school ?? "");
  if (matches(L, id, ["degree"])) return set(profile.education[0]?.degree ?? "");

  // Current employer / title
  if (matches(L, id, ["current company", "current employer"]))
    return set(profile.experience[0]?.company ?? "");
  if (matches(L, id, ["current title", "current role"]))
    return set(profile.experience[0]?.title ?? "");

  // Cover letter
  if (matches(L, id, ["cover letter"])) return set(app.coverLetterSnippet ?? "", 0.5, "Stub; recommend Claude generation");

  return null;
}

function matches(label: string, id: string, needles: string[]): boolean {
  return needles.some((n) => label.includes(n) || id.includes(n));
}

function splitName(name: string): { first: string; last: string } {
  const parts = (name ?? "").trim().split(/\s+/);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

/**
 * For yes/no fields, map a boolean onto the closest option label.
 * Falls back to the boolean itself for plain yes_no inputs.
 */
function toYesNo(field: FormField, yes: boolean): any {
  if (field.type === "yes_no") return yes ? "Yes" : "No";
  if (field.options && field.options.length > 0) {
    const pick = field.options.find((o) => /yes/i.test(o.label) === yes && /no/i.test(o.label) !== yes);
    if (pick) return pick.value;
    return yes ? field.options[0].value : field.options[field.options.length - 1].value;
  }
  return yes ? "Yes" : "No";
}
