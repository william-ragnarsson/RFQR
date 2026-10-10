// Which AI model reads which input. One place, so the canvas, the drawer and
// the pipeline all agree.
//
// The server pipeline reads the model ids from env (TEXT_MODEL / PDF_MODEL),
// falling back to the ids below, and every ExtractorResult carries the id it
// actually used. The canvas shows display names via modelInfo(id).

export type ModelProvider = "openai" | "anthropic";

export interface ModelInfo {
  /** Gateway model id, "<provider>/<model>". Matches ExtractorResult.model. */
  id: string;
  /** Display name, e.g. "GPT-5.4 mini". */
  name: string;
  /** Short name for chips, e.g. "GPT". */
  short: string;
  provider: ModelProvider;
}

export type ModelSlot = "text" | "pdf";

export const MODELS: Record<ModelSlot, ModelInfo> = {
  // Reads the email body (quantity, customer, ...).
  text: { id: "openai/gpt-5.4-mini", name: "GPT-5.4 mini", short: "GPT", provider: "openai" },
  // Reads the attached PDF spec sheet (material specs).
  pdf: { id: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5", short: "Claude", provider: "anthropic" },
};

/** Display info for a model id; falls back to the id itself for unknown models. */
export function modelInfo(id: string): ModelInfo {
  const known = Object.values(MODELS).find((m) => m.id === id);
  if (known) return known;
  const [prefix, ...rest] = id.split("/");
  const provider: ModelProvider = prefix === "anthropic" ? "anthropic" : "openai";
  const name = rest.join("/") || id;
  return { id, name, short: provider === "anthropic" ? "Claude" : "GPT", provider };
}
