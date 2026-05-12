import type { ParsedForm, FormField, FieldType } from "../types.js";

/**
 * Ashby posting form endpoint:
 *   https://api.ashbyhq.com/posting-api/job-board/{org}/{jobId}
 * The `applicationForm` block contains `formDefinition` (array of fields).
 */
export async function parseAshbyForm(jobUrl: string): Promise<ParsedForm> {
  const { slug, jobId } = parseAshbyUrl(jobUrl);
  const api = `https://api.ashbyhq.com/posting-api/job-board/${slug}/${jobId}`;
  const res = await fetch(api);
  if (!res.ok) throw new Error(`Ashby form fetch ${res.status}`);
  const data = (await res.json()) as any;
  const formDef: any[] = data.applicationForm?.formDefinition ?? data.formFields ?? [];

  const fields: FormField[] = formDef.map((f: any) => ({
    id: f.path ?? f.id ?? f.fieldId,
    label: f.title ?? f.label ?? f.path,
    type: ashbyType(f.type ?? f.fieldType, f.title ?? ""),
    required: !!f.isRequired,
    options: (f.selectableValues ?? f.options ?? []).map((o: any) => ({
      value: String(o.value ?? o),
      label: String(o.label ?? o.value ?? o),
    })),
    description: f.descriptionPlain ?? f.description,
  }));

  return {
    source: "ashby",
    jobBoardToken: slug,
    jobId,
    applyUrl: jobUrl,
    fields,
    meta: { applicationFormId: data.applicationForm?.id },
  };
}

function parseAshbyUrl(url: string): { slug: string; jobId: string } {
  const m = url.match(/jobs\.ashbyhq\.com\/([^/]+)\/([a-f0-9-]+)/);
  if (!m) throw new Error(`Could not parse Ashby URL: ${url}`);
  return { slug: m[1], jobId: m[2] };
}

function ashbyType(t: string, label: string): FieldType {
  const L = label.toLowerCase();
  switch ((t ?? "").toLowerCase()) {
    case "string":
    case "text":
      if (L.includes("email")) return "email";
      if (L.includes("phone")) return "phone";
      if (L.includes("url") || L.includes("link")) return "url";
      return "text";
    case "longtext":
    case "textarea":
      return "textarea";
    case "number":
    case "currency":
      return "number";
    case "boolean":
    case "yesno":
      return "yes_no";
    case "valueselect":
    case "select":
      return "select";
    case "multiselect":
      return "multiselect";
    case "date":
      return "date";
    case "file":
    case "fileupload":
      return "file";
    default:
      return "unknown";
  }
}
