import type { ParsedForm, FormField, FieldType } from "../types.js";

/**
 * Lever posting endpoint:
 *   https://api.lever.co/v0/postings/{slug}/{jobId}?mode=json
 * The response includes `applicationQuestions` and standard fields.
 */
export async function parseLeverForm(jobUrl: string): Promise<ParsedForm> {
  const { slug, jobId } = parseLeverUrl(jobUrl);
  const api = `https://api.lever.co/v0/postings/${slug}/${jobId}?mode=json`;
  const res = await fetch(api);
  if (!res.ok) throw new Error(`Lever form fetch ${res.status}`);
  const data = (await res.json()) as any;

  const fields: FormField[] = [];

  // Standard fields most Lever forms require
  fields.push(
    { id: "name", label: "Full name", type: "text", required: true },
    { id: "email", label: "Email", type: "email", required: true },
    { id: "phone", label: "Phone", type: "phone", required: false },
    { id: "org", label: "Current company", type: "text", required: false },
    { id: "urls[LinkedIn]", label: "LinkedIn URL", type: "url", required: false },
    { id: "urls[GitHub]", label: "GitHub URL", type: "url", required: false },
    { id: "urls[Portfolio]", label: "Portfolio / website", type: "url", required: false },
    { id: "resume", label: "Resume", type: "file", required: true },
  );

  for (const q of data.applicationQuestions ?? []) {
    const isReq = !!q.required;
    const sectionLabel = q.text ?? q.title ?? "Custom";
    for (const f of q.fields ?? []) {
      const opts = (f.options ?? []).map((o: any) => ({
        value: String(o.text ?? o),
        label: String(o.text ?? o),
      }));
      fields.push({
        id: f.identifier ?? f.text ?? sectionLabel,
        label: f.text ?? sectionLabel,
        type: leverType(f.type),
        required: isReq,
        options: opts,
        description: q.description,
        section: "custom",
      });
    }
  }

  return {
    source: "lever",
    jobBoardToken: slug,
    jobId,
    applyUrl: jobUrl,
    fields,
  };
}

function parseLeverUrl(url: string): { slug: string; jobId: string } {
  const m = url.match(/jobs\.lever\.co\/([^/]+)\/([a-f0-9-]+)/);
  if (!m) throw new Error(`Could not parse Lever URL: ${url}`);
  return { slug: m[1], jobId: m[2] };
}

function leverType(t: string): FieldType {
  switch (t) {
    case "text":
      return "text";
    case "textarea":
      return "textarea";
    case "dropdown":
    case "multiple-select":
      return "select";
    case "multiple-choice":
      return "multiselect";
    case "yes-no":
      return "yes_no";
    case "date":
      return "date";
    case "file":
      return "file";
    default:
      return "unknown";
  }
}
