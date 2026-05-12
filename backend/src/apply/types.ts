// Normalized form schema we use across all ATS providers.
export type FieldType =
  | "text"
  | "textarea"
  | "email"
  | "phone"
  | "number"
  | "url"
  | "select"
  | "multiselect"
  | "yes_no"
  | "date"
  | "file"
  | "checkbox"
  | "unknown";

export interface FormField {
  id: string;            // upstream id used when posting
  label: string;         // human label
  type: FieldType;
  required: boolean;
  options?: { value: string; label: string }[];
  section?: string;      // e.g. "Education", "EEO"
  description?: string;  // help/hint text
}

export interface ParsedForm {
  source: "greenhouse" | "lever" | "ashby";
  jobBoardToken: string; // company slug
  jobId: string;         // upstream job id
  applyUrl: string;
  fields: FormField[];
  // Extra ATS state we need to send back on submit (CSRF, anti-spam tokens).
  meta?: Record<string, any>;
}

export interface PlannedField {
  id: string;
  label: string;
  type: FieldType;
  value: any;
  /** Where the value came from. */
  source: "profile" | "heuristic" | "llm" | "default" | "missing";
  /** 0-1; <0.6 is shown for review. */
  confidence: number;
  reason?: string;
  required: boolean;
}

export interface FieldPlan {
  fields: PlannedField[];
  unresolved: PlannedField[]; // required but value missing or low-confidence
  warnings: string[];
}
