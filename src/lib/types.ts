// Shared contract between the pipeline (server) and the canvas (client).

export type NodeId = "gmail" | "text" | "pdf" | "template" | "inventory" | "reply";

export type NodeStatus =
  | "idle"
  | "running"
  | "done"
  | "warning" // finished, but something needs attention (e.g. missing fields)
  | "error"
  | "skipped"
  | "awaiting"; // reply drafted, waiting for Thomas to approve

export type Source = "email" | "pdf";

export interface TemplateField {
  key: string;
  label: string;
  required: boolean;
  type: "string" | "number" | "integer" | "enum" | "date";
  options?: string[];
  hint?: string;
}

export interface OrderTemplate {
  id: string;
  name: string;
  company: string;
  description: string;
  fields: TemplateField[];
}

export interface InventoryItem {
  sku: string;
  description: string;
  material: string;
  grade: string;
  standard: string;
  thickness_in: number;
  width_in: number;
  length_in: number;
  finish: string;
  on_hand: number;
  unit_price: number;
  origin: string;
  mtr: string;
}

/** One value an AI model pulled out of one input, with the exact words it came from. */
export interface Extraction {
  key: string;
  value: string | number | null;
  quote: string | null;
}

export interface ExtractorResult {
  source: Source;
  model: string; // e.g. "openai/gpt-5.4-mini"
  fields: Extraction[];
  ms: number;
}

export type FieldStatus = "ok" | "missing" | "invalid" | "conflict";

/** A template field after merging both extractions and validating in plain code. */
export interface FilledField {
  key: string;
  label: string;
  required: boolean;
  value: string | number | null;
  source: Source | null;
  quote: string | null;
  status: FieldStatus;
  note?: string; // why it is missing / invalid / conflicting
}

export interface FilledForm {
  templateId: string;
  fields: FilledField[];
  complete: boolean;
  missing: string[]; // labels of required fields that are not ok
}

export interface InventoryResult {
  match: InventoryItem | null;
  requested: number;
  available: number;
  fulfillable: boolean;
  total: number | null;
  reason: string;
}

export interface IncomingEmail {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  receivedAt: string;
  attachment: { filename: string; pages: number } | null;
}

export type Outcome = "confirmed" | "clarify" | "unavailable";

export interface ReplyDraft {
  to: string;
  subject: string;
  body: string;
  outcome: Outcome;
}

export interface NodeState {
  status: NodeStatus;
  summary?: string; // one short line shown under the node
}

export interface RunState {
  id: string;
  startedAt: string;
  nodes: Record<NodeId, NodeState>;
  email?: IncomingEmail;
  text?: ExtractorResult;
  pdf?: ExtractorResult & { pageImages?: string[] }; // data URLs of rendered pages
  form?: FilledForm;
  inventory?: InventoryResult;
  reply?: ReplyDraft & { sentAt?: string };
}

export const NODE_IDS: NodeId[] = ["gmail", "text", "pdf", "template", "inventory", "reply"];
