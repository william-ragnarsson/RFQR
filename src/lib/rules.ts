// The plain-code rules shared by the real pipeline and the canvas simulator:
// merging both extractions into the order template, validating every value,
// the stock lookup and the reply draft. No AI here and no Node APIs, so the
// canvas can import it too.
//
// The AI only ever proposes field values (with the words they came from).
// Everything that decides what Thomas is asked to send happens below.

import scenariosData from "../../data/demo/scenarios.json";
import templateData from "../../data/order-template.json";
import inventoryData from "../../data/inventory.json";
import { containsToken } from "./extraction-checks";
import type {
  Extraction,
  ExtractorResult,
  FilledField,
  FilledForm,
  IncomingEmail,
  InventoryItem,
  InventoryResult,
  OrderTemplate,
  Outcome,
  ReplyDraft,
  Source,
  TemplateField,
} from "./types";

// ---------------------------------------------------------------------------
// Reference data

/** Shown on the canvas. The server reads the real address from RFQ_ADDRESS. */
export const RFQ_INBOX = "william.ragnarsson+rfq@gmail.com";

export const ORDER_TEMPLATE = templateData as OrderTemplate;

export const STOCK = {
  warehouse: inventoryData.warehouse,
  updated: inventoryData.updated,
  currency: inventoryData.currency,
  items: inventoryData.items as InventoryItem[],
};

export const SELLER = scenariosData.seller;

export const OUTCOME_LABELS: Record<Outcome, string> = {
  confirmed: "Order confirmation",
  clarify: "Clarifying question",
  unavailable: "Cannot fulfill",
};

// ---------------------------------------------------------------------------
// Extractor results

/** One entry per template field, in template order (null where nothing was found). */
export function completeFields(found: Extraction[]): Extraction[] {
  return ORDER_TEMPLATE.fields.map(
    (f) => found.find((e) => e.key === f.key) ?? { key: f.key, value: null, quote: null },
  );
}

/** A result with nothing found, e.g. when there is no PDF or a model call failed. */
export function emptyResult(source: Source, model: string): ExtractorResult {
  return { source, model, fields: completeFields([]), ms: 0 };
}

export function countFound(result: ExtractorResult): number {
  return result.fields.filter((f) => f.value !== null).length;
}

// ---------------------------------------------------------------------------
// Merge + validate

function sameValue(a: string | number, b: string | number): boolean {
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

/** Returns a problem description, or null when the value fits the template field. */
function validate(field: TemplateField, value: string | number): string | null {
  switch (field.type) {
    case "number":
      return typeof value === "number" && Number.isFinite(value) && value > 0
        ? null
        : `“${value}” is not a positive number.`;
    case "integer":
      return typeof value === "number" && Number.isInteger(value) && value > 0
        ? null
        : `“${value}” is not a whole number.`;
    case "enum":
      return field.options?.includes(String(value))
        ? null
        : `“${value}” is not one of: ${field.options?.join(", ")}.`;
    case "date": {
      // Round-trip so "2026-02-30" (which Date.parse rolls over to March 2) is rejected.
      const day = String(value);
      const parsed = /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T00:00:00Z`) : null;
      if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) {
        return `“${value}” is not a calendar date.`;
      }
      return day < new Date().toISOString().slice(0, 10) ? `${day} is in the past.` : null;
    }
    default:
      return String(value).trim() ? null : "Empty value.";
  }
}

const SOURCE_NAMES: Record<Source, string> = { email: "email", pdf: "PDF" };

function hasValue(x: Extraction | undefined): x is Extraction & { value: string | number } {
  return x?.value != null;
}

/** A value whose quote was not found word for word in its source is never trusted. */
function trusted(x: Extraction | undefined): x is Extraction & { value: string | number } {
  return hasValue(x) && x.verified !== false;
}

/**
 * Fill the order template from both extractions. Rule: the email wins, the PDF
 * fills the gaps; if both state a trusted value and they disagree, it is a
 * conflict. A value whose quote isn't in its source (verified === false) only
 * counts when the other side has nothing trusted, and then it is "invalid".
 */
export function fillForm(
  text: ExtractorResult,
  pdf: ExtractorResult,
  notes: Record<string, string> = {},
): FilledForm {
  const fields: FilledField[] = ORDER_TEMPLATE.fields.map((field) => {
    const e = text.fields.find((x) => x.key === field.key);
    const p = pdf.fields.find((x) => x.key === field.key);
    const base = { key: field.key, label: field.label, required: field.required };
    const optional = (note: string) =>
      field.required ? note : `${note} Optional, so it doesn't block the order.`;

    if (trusted(e) && trusted(p) && !sameValue(e.value, p.value)) {
      return {
        ...base,
        value: e.value,
        source: "email",
        quote: e.quote,
        status: "conflict",
        note: `The email says “${e.value}” but the PDF says “${p.value}”.`,
        verified: e.verified,
      };
    }

    const pick = trusted(e) ? e : trusted(p) ? p : hasValue(e) ? e : hasValue(p) ? p : null;
    if (!pick) {
      // Keep the words that explain the gap (e.g. "Per drawing D-2231"), but only
      // words that really are in the source: the reply may quote them back.
      const hint =
        p?.quote && p.verified !== false ? p : e?.quote && e.verified !== false ? e : null;
      const hintSource: Source | null = hint ? (hint === p ? "pdf" : "email") : null;
      return {
        ...base,
        value: null,
        source: hintSource,
        quote: hint?.quote ?? null,
        status: "missing",
        note:
          notes[field.key] ??
          (hint && hintSource
            ? `The ${SOURCE_NAMES[hintSource]} only says “${hint.quote}”, so we won't guess.`
            : "Not stated in the email or the PDF."),
        verified: hint?.verified,
      };
    }

    const source: Source = pick === e ? "email" : "pdf";
    const filled: FilledField = {
      ...base,
      value: pick.value,
      source,
      quote: pick.quote,
      status: "ok",
      verified: pick.verified,
    };
    const problem =
      pick.verified === false
        ? `The AI's quote isn't in the ${SOURCE_NAMES[source]} or doesn't state this value, so it isn't trusted.`
        : validate(field, pick.value);
    if (problem) {
      filled.status = "invalid";
      filled.note = optional(problem);
    }
    return filled;
  });

  const missing = fields.filter((f) => f.required && f.status !== "ok").map((f) => f.label);
  return { templateId: ORDER_TEMPLATE.id, fields, complete: missing.length === 0, missing };
}

// ---------------------------------------------------------------------------
// Stock lookup

function fieldValue(form: FilledForm, key: string): string | number | null {
  const f = form.fields.find((x) => x.key === key);
  return f && f.status === "ok" ? f.value : null;
}

export function formatMoney(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "ASTM A240 / ASME SA240" -> ["A240", "A240"]: designations without the body prefix. */
function designations(standard: string): string[] {
  return standard
    .split(/[/,;]|\bor\b|\band\b/i)
    .map((part) =>
      part
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .replace(/^(?:ASTM|ASME|AISI|EN|ISO|DIN)/, "")
        .replace(/^SA(?=\d)/, "A"), // ASME SA240 is ASTM A240
    )
    .filter(Boolean);
}

function sameStandard(stock: string, requested: string | number | null): boolean {
  const ours = designations(stock);
  return designations(String(requested ?? "")).some((d) => ours.includes(d));
}

const sameSize = (a: number, b: string | number | null) =>
  typeof b === "number" && Math.abs(a - b) <= 0.001;

/** EN 10204 types named in a text, e.g. "3.1". */
function certTypes(text: string): number[] {
  return [...text.matchAll(/(?<![\d.])([23]\.[12])(?![\d])/g)].map((m) => Number(m[1]));
}

/**
 * A stock MTR satisfies the request when the request names no EN 10204 type,
 * or when it is at least the lowest type named (a 3.1 covers a 2.2 request,
 * not a 3.2 one).
 */
function certificationOk(mtr: string, requested: string | number | null): boolean {
  const wanted = certTypes(String(requested ?? ""));
  const ours = certTypes(mtr);
  return wanted.length === 0 || (ours.length > 0 && ours[0] >= Math.min(...wanted));
}

const ORIGIN_NAMES: Record<string, string[]> = {
  USA: ["U.S.A.", "U.S.", "United States", "America"],
};
const EU_MEMBERS = [
  "Austria", "Belgium", "Bulgaria", "Croatia", "Cyprus", "Czechia", "Denmark", "Estonia",
  "Finland", "France", "Germany", "Greece", "Hungary", "Ireland", "Italy", "Latvia",
  "Lithuania", "Luxembourg", "Malta", "Netherlands", "Poland", "Portugal", "Romania",
  "Slovakia", "Slovenia", "Spain", "Sweden",
];

/**
 * Origin is optional: only an ok value restricts, and then it must name the
 * stock origin (or the EU / Europe for an EU origin), unless it says "any".
 */
function originOk(origin: string, requested: string | number | null): boolean {
  if (requested === null) return true;
  const text = String(requested);
  if (/\b(?:any|no (?:preference|restriction|requirement)|not required)\b/i.test(text)) return true;
  const names = [origin, ...(ORIGIN_NAMES[origin] ?? [])];
  if (EU_MEMBERS.includes(origin)) names.push("EU", "E.U.", "European Union", "Europe", "European");
  return names.some((n) => containsToken(text, n));
}

export function checkInventory(form: FilledForm): InventoryResult {
  const v = (key: string) => fieldValue(form, key);
  const requested = Number(v("quantity") ?? 0);
  const sameSpec = (item: InventoryItem) =>
    sameValue(item.material, v("material") ?? "") &&
    sameValue(item.grade, v("grade") ?? "") &&
    sameStandard(item.standard, v("standard")) &&
    sameSize(item.thickness_in, v("thickness_in")) &&
    sameSize(item.width_in, v("width_in")) &&
    sameSize(item.length_in, v("length_in")) &&
    sameValue(item.finish, v("finish") ?? "");
  const candidates = STOCK.items.filter(sameSpec);
  const match =
    candidates.find(
      (item) =>
        certificationOk(item.mtr, v("certification")) && originOk(item.origin, v("country_of_origin")),
    ) ?? null;

  if (!match) {
    const near = candidates[0];
    return {
      match: null,
      requested,
      available: 0,
      fulfillable: false,
      total: null,
      reason: !near
        ? "No stock item matches this specification."
        : !certificationOk(near.mtr, v("certification"))
          ? `SKU ${near.sku} matches, but it ships with an ${near.mtr} certificate, not the one requested.`
          : `SKU ${near.sku} matches, but its origin (${near.origin}) isn't one the buyer accepts.`,
    };
  }

  const fulfillable = match.on_hand >= requested;
  return {
    match,
    requested,
    available: match.on_hand,
    fulfillable,
    total: fulfillable ? Math.round(requested * match.unit_price * 100) / 100 : null,
    reason: fulfillable
      ? `${requested} of ${match.on_hand} sheets on hand at ${formatMoney(match.unit_price)} ${STOCK.currency} each.`
      : `Only ${match.on_hand} of the ${requested} requested sheets are on hand.`,
  };
}

// ---------------------------------------------------------------------------
// Reply draft (Thomas approves before anything is sent)

const FINISH_NAMES: Record<string, string> = { "2B": "2B", "#4": "#4 brushed", BA: "BA" };

function listOr(items: string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`;
}

/**
 * The sender's name from a From header: "Laura Chen <l@x>" -> "Laura Chen",
 * "\"Chen, Laura\" <l@x>" -> "Laura Chen", a bare address -> "".
 */
export function senderName(from: string): string {
  const name = from
    .replace(/<[^<>]*>\s*$/, "")
    .replace(/["']/g, "")
    .trim();
  if (!name || name.includes("@")) return "";
  const [last, first] = name.split(/\s*,\s*/);
  return first ? `${first} ${last}` : name;
}

function firstName(from: string): string {
  return senderName(from).split(/\s+/)[0] || "there";
}

/**
 * The buyer's own words, but only when plain code found them word for word in
 * what they sent (never an unchecked quote) and they are short.
 */
function ownWords(field: FilledField): string | null {
  if (field.verified !== true || !field.quote) return null;
  const quote = field.quote.replace(/\s+/g, " ").trim();
  return quote.length <= 80 ? quote : null;
}

function question(field: FilledField): string {
  if (field.status === "conflict") {
    return `${field.label} — your email and the attached spec give different values. Which one is correct?`;
  }
  switch (field.key) {
    case "thickness_in": {
      const said = ownWords(field);
      const where = field.source === "email" ? "your email" : "your spec";
      return said
        ? `Thickness — ${where} says “${said}”${/drawing/i.test(said) ? ", but the drawing wasn't attached" : ""}. What thickness (or gauge) do you need?`
        : "Thickness — what thickness (or gauge) do you need?";
    }
    case "finish": {
      const options = ORDER_TEMPLATE.fields.find((f) => f.key === "finish")?.options ?? [];
      return `Finish — which surface finish do you need: ${listOr(options.map((o) => FINISH_NAMES[o] ?? o))}?`;
    }
    default:
      return `${field.label} — could you confirm this?`;
  }
}

const COUNT_WORDS = ["no", "one", "two", "three", "four", "five"];

export function draftReply(
  email: IncomingEmail,
  form: FilledForm,
  inventory: InventoryResult | null,
): ReplyDraft {
  const v = (key: string) => fieldValue(form, key);
  const signature = `Best regards,\n${SELLER.name}\n${SELLER.role}, ${SELLER.company}`;
  const greeting = `Hi ${firstName(email.from)},`;
  const what = [v("grade"), v("material")].filter((x) => x != null).join(" ") || "sheet";
  const qty = v("quantity");
  const request = qty != null ? `${qty} sheets of ${what}` : what;
  const subject = /^re:/i.test(email.subject.trim()) ? email.subject.trim() : `Re: ${email.subject}`;
  const base = { to: email.from, subject };

  if (!form.complete || !inventory) {
    const open = form.fields.filter((f) => f.required && f.status !== "ok");
    const n = open.length;
    const count = `${COUNT_WORDS[n] ?? n} more detail${n === 1 ? "" : "s"}`;
    const body = [
      greeting,
      "",
      `Thank you for your RFQ for ${request}. Before we can check stock and quote a price, we need ${count}:`,
      "",
      ...open.map((f, i) => `${i + 1}. ${question(f)}`),
      "",
      "As soon as we have these, we'll come back to you with availability and a price.",
      "",
      signature,
    ].join("\n");
    return { ...base, body, outcome: "clarify" };
  }

  const m = inventory.match;
  const cur = STOCK.currency;

  if (inventory.fulfillable && m && inventory.total !== null) {
    const delivery = v("delivery_date");
    const body = [
      greeting,
      "",
      "Thank you for your RFQ. We can supply the full quantity from stock:",
      "",
      `  ${inventory.requested} x ${m.description}`,
      `  ${m.standard} · SKU ${m.sku}`,
      `  Unit price: ${formatMoney(m.unit_price)} ${cur}`,
      `  Line total: ${formatMoney(inventory.total)} ${cur}`,
      "",
      `An ${m.mtr} mill test report (MTR) is included with the shipment. Country of origin: ${m.origin}.`,
      // Never promise a delivery date: only acknowledge the one they asked for.
      delivery
        ? `We've noted your requested delivery date of ${delivery} and will confirm the ship date with your order.`
        : "We'll confirm the ship date together with your order.",
      "",
      "Reply to this email to confirm the order and we'll schedule the shipment.",
      "",
      signature,
    ].join("\n");
    return { ...base, body, outcome: "confirmed" };
  }

  const lines = [greeting, "", `Thank you for your RFQ for ${request}.`, ""];
  if (m && inventory.available > 0) {
    const rest = inventory.requested - inventory.available;
    lines.push(
      `Unfortunately we can't supply all ${inventory.requested} sheets: we have ${inventory.available} in stock right now.`,
      "",
      `  SKU ${m.sku} · ${m.description}`,
      `  Origin: ${m.origin} · ${m.mtr} mill test report included`,
      "",
      `If it helps, we can ship those ${inventory.available} sheets now as a partial delivery:`,
      `  ${inventory.available} x ${formatMoney(m.unit_price)} ${cur} = ${formatMoney(inventory.available * m.unit_price)} ${cur}`,
      "",
      `We'll follow up separately on lead time for the remaining ${rest} sheets.`,
    );
  } else {
    lines.push(
      "Unfortunately we don't currently stock sheet matching this specification.",
      "We'll come back to you on whether we can source it.",
    );
  }
  lines.push("", signature);
  return { ...base, body: lines.join("\n"), outcome: "unavailable" };
}
