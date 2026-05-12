import type { ParsedForm, FormField, FieldType } from "../types.js";

/**
 * Greenhouse exposes the application form schema via its boards API:
 *   https://boards-api.greenhouse.io/v1/boards/{slug}/jobs/{id}?questions=true
 *
 * The job URL on greenhouse.io is shaped like:
 *   https://boards.greenhouse.io/{slug}/jobs/{id}
 *   https://job-boards.greenhouse.io/{slug}/jobs/{id}
 */
export async function parseGreenhouseForm(jobUrl: string): Promise<ParsedForm> {
  const { slug, jobId } = parseGreenhouseUrl(jobUrl);
  const api = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${jobId}?questions=true`;
  const res = await fetch(api);
  if (!res.ok) throw new Error(`Greenhouse form fetch ${res.status}`);
  const data = (await res.json()) as any;

  const fields: FormField[] = [];
  for (const q of data.questions ?? []) {
    for (const f of q.fields ?? []) {
      fields.push({
        id: f.name,
        label: q.label,
        type: ghType(f.type, q.label),
        required: !!q.required,
        options: (f.values ?? []).map((v: any) => ({
          value: String(v.value),
          label: String(v.label ?? v.value),
        })),
        description: q.description?.replace(/<[^>]+>/g, " ").trim(),
      });
    }
  }
  // Compliance (EEO) questions
  for (const q of data.compliance ?? []) {
    for (const sq of q.questions ?? []) {
      for (const f of sq.fields ?? []) {
        fields.push({
          id: f.name,
          label: sq.label,
          type: ghType(f.type, sq.label),
          required: !!sq.required,
          options: (f.values ?? []).map((v: any) => ({
            value: String(v.value),
            label: String(v.label ?? v.value),
          })),
          section: q.type ?? "compliance",
        });
      }
    }
  }

  return {
    source: "greenhouse",
    jobBoardToken: slug,
    jobId,
    applyUrl: jobUrl,
    fields,
  };
}

function parseGreenhouseUrl(url: string): { slug: string; jobId: string } {
  const m = url.match(/greenhouse\.io\/([^/]+)\/jobs\/(\d+)/);
  if (m) return { slug: m[1], jobId: m[2] };
  const m2 = url.match(/embed\/job_app\?for=([^&]+)&token=(\d+)/);
  if (m2) return { slug: m2[1], jobId: m2[2] };
  throw new Error(`Could not parse Greenhouse URL: ${url}`);
}

function ghType(t: string, label: string): FieldType {
  const L = label.toLowerCase();
  if (t === "input_file") return "file";
  if (t === "textarea") return "textarea";
  if (t === "multi_value_single_select") return "select";
  if (t === "multi_value_multi_select") return "multiselect";
  if (t === "input_text") {
    if (L.includes("email")) return "email";
    if (L.includes("phone")) return "phone";
    if (L.includes("url") || L.includes("website") || L.includes("linkedin") || L.includes("github")) return "url";
    return "text";
  }
  return "unknown";
}
