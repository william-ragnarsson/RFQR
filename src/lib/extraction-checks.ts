// Plain-code checks of what the AI extractors return: the "trust" layer.
//
// A model only proposes values. Before anything uses them, this code
// normalises each value to its template field type (conservatively: anything
// ambiguous is left as-is so validation flags it) and checks that each quote
// appears word for word in the source the model was given, and that the quote
// actually states the value (a model could quote "40 sheets" and return 4).
// Pure functions, no Node APIs: safe to import from the client.

import type { Extraction, OrderTemplate, TemplateField } from "./types";

/** What a model hands back for one field, before any checks (types not trusted). */
export interface RawExtraction {
  key: string;
  value?: unknown;
  quote?: unknown;
}

// A plain number, optionally followed by an inch unit: "0.060", ".135", "48 in", '48"'.
const NUMBER_IN_INCHES = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(?:in\.?|inch(?:es)?|")?$/i;
// A whole number; "40.0" is accepted, "40.5", "1,000" and "40 sheets" are not.
const WHOLE_NUMBER = /^[+-]?\d+(?:\.0+)?$/;

/** Empty, or the word "null" (models sometimes write null as a string). */
function isBlank(s: string): boolean {
  const t = s.trim().toLowerCase();
  return t === "" || t === "null";
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `option` as a whole token: letters and digits around it break the match ("304" is not in "304L"). */
export function containsToken(text: string, option: string): boolean {
  const pattern = escapeRegExp(option).replace(/\s+/g, "\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, "iu").test(text);
}

/** "304 L" / "316-L" -> "304L" / "316L", so the low-carbon grade isn't read as the plain one. */
function joinGradeSuffix(text: string): string {
  return text.replace(/(\d)[\s-]+l\b/gi, "$1L");
}

function normalizeEnum(field: TemplateField, raw: string): string {
  const options = field.options ?? [];
  const text = joinGradeSuffix(raw);
  const exact = options.find((o) => o.toLowerCase() === text.toLowerCase());
  if (exact) return exact;
  // "AISI 304" -> "304", "2B finish" -> "2B"; but "304/304L" stays as-is (two options).
  const found = options.filter((o) => containsToken(text, o));
  return found.length === 1 ? found[0] : text;
}

/**
 * Coerces a model's value to the template field's type. Only unambiguous
 * conversions are made; anything else is returned unchanged (validation will
 * flag it). Gauge is NEVER converted here: the model does that per the hint.
 */
export function normalizeValue(field: TemplateField, raw: unknown): string | number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    return field.type === "enum" ? normalizeEnum(field, String(raw)) : raw;
  }
  if (typeof raw !== "string") return null;

  if (isBlank(raw)) return null;
  const text = raw.trim();

  switch (field.type) {
    case "number": {
      const m = NUMBER_IN_INCHES.exec(text);
      return m ? Number(m[1]) : text;
    }
    case "integer":
      return WHOLE_NUMBER.test(text) ? Number(text) : text;
    case "enum":
      return normalizeEnum(field, text);
    case "date":
      return text; // "YYYY-MM-DD" passes validation; anything else is flagged there
    default:
      return text;
  }
}

/**
 * Lowercase, straight quotes, plain dashes, single spaces. Label separators
 * (":", "|", bullets, a spaced " - ") count as spaces, so a quote written as
 * "Thickness: 16 ga" still matches a PDF table cell pair "Thickness / 16 ga".
 */
function normalizeText(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/[:|•·]/g, " ")
    .replace(/\s-\s/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strips what a model tends to wrap around a quote: quote marks, "...", a trailing period or comma. */
function unwrapQuote(s: string): string {
  let prev: string;
  do {
    prev = s;
    s = s
      .replace(/^["']+|["']+$/g, "")
      .replace(/^(?:\.\.\.)+|(?:\.\.\.)+$/g, "")
      .replace(/[.,]$/, "")
      .trim();
  } while (s !== prev);
  return s;
}

/**
 * Whether `quote` appears word for word in `source` (ignoring case, whitespace
 * and typographic quotes/dashes). null when there is nothing to check against.
 */
export function verifyQuote(quote: string | null, source: string | null): boolean | null {
  if (quote === null || source === null) return null;
  const q = unwrapQuote(normalizeText(quote));
  if (!q) return false;
  return normalizeText(source).includes(q);
}

// Other words buyers use for an enum option (the option itself always counts).
const OPTION_WORDS: Record<string, string[]> = {
  "stainless steel": ["stainless", "inox"],
  "carbon steel": ["carbon", "mild steel"],
  aluminum: ["aluminium"],
  "#4": ["no. 4", "no 4", "brushed"],
  BA: ["bright annealed"],
};

/** The numbers written in `text`: "1,000" -> 1000, "1/8" -> 0.125, "4 ft" -> 4 and 48. */
function numbersIn(text: string): number[] {
  const out: number[] = [];
  const pattern = /(\d[\d,]*(?:\.\d+)?|\.\d+)(?:\s*\/\s*(\d+))?\s*('|ft\b|feet\b|foot\b)?/gi;
  for (const m of text.matchAll(pattern)) {
    let n = Number(m[1].replace(/,/g, ""));
    if (m[2]) n = n / Number(m[2]);
    if (!Number.isFinite(n)) continue;
    out.push(n);
    if (m[3]) out.push(n * 12); // feet -> inches
  }
  return out;
}

/** Gauge table from the field hint, e.g. "10 ga = 0.135" -> { 10: 0.135 }. */
function gaugesIn(hint: string | undefined): Map<number, number> {
  const table = new Map<number, number>();
  for (const m of (hint ?? "").matchAll(/(\d+)\s*ga\s*=\s*([\d.]+)/gi)) {
    table.set(Number(m[1]), Number(m[2]));
  }
  return table;
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/**
 * Whether the quoted words state `value`: a number must appear in the quote
 * (or a gauge from the field hint that converts to it), an enum option must
 * appear as a word. Free-text and date fields are not checked here.
 */
function quoteStatesValue(field: TemplateField, value: string | number, quote: string): boolean {
  const text = joinGradeSuffix(quote.normalize("NFKC"));
  switch (field.type) {
    case "number":
    case "integer": {
      if (typeof value !== "number") return true; // not a number: validation flags it
      if (numbersIn(text).some((n) => near(n, value))) return true;
      const gauges = gaugesIn(field.hint);
      return [...text.matchAll(/(\d+)\s*(?:ga|gauge|gage)\b/gi)].some((m) => {
        const inches = gauges.get(Number(m[1]));
        return inches !== undefined && Math.abs(inches - value) <= 0.001; // 16 ga: 0.060 or 0.0598
      });
    }
    case "enum": {
      const words = [String(value), ...(OPTION_WORDS[String(value)] ?? [])];
      return words.some((w) => containsToken(text, w));
    }
    default:
      return true;
  }
}

/**
 * One checked entry per template field, in template order: values normalised,
 * quotes verified against `source` (null = no text to check against, e.g. a
 * scanned PDF) and checked to state the value. Unknown keys are dropped;
 * missing fields come back empty.
 */
export function checkExtractions(
  fields: RawExtraction[],
  template: OrderTemplate,
  source: string | null,
): Extraction[] {
  return template.fields.map((field) => {
    const raw = fields.find((f) => f.key === field.key);
    const value = normalizeValue(field, raw?.value);
    const quote = typeof raw?.quote === "string" && !isBlank(raw.quote) ? raw.quote : null;

    let verified: boolean | null;
    if (quote !== null) verified = verifyQuote(quote, source);
    else if (value !== null) verified = source === null ? null : false; // no evidence, not trusted
    else verified = null; // nothing stated, nothing to check
    // A quote that doesn't state the value is no evidence for it, wherever it came from.
    if (quote !== null && value !== null && !quoteStatesValue(field, value, quote)) verified = false;

    return { key: field.key, value, quote, verified };
  });
}
