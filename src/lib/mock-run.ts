// Simulated pipeline run for the canvas demo. No network, no AI calls.
//
// Only the two "AI" steps are canned: the extractions below are what the models
// are expected to return for the demo emails/PDFs (every quote is an exact
// substring of the email body or of a PDF row value). Everything after that —
// merging, validation, the stock lookup and the reply draft — is plain code,
// exactly like the real pipeline will be.

import scenariosData from "../../data/demo/scenarios.json";
import templateData from "../../data/order-template.json";
import inventoryData from "../../data/inventory.json";
import { MODELS } from "./models";
import type {
  Extraction,
  ExtractorResult,
  FilledField,
  FilledForm,
  IncomingEmail,
  InventoryItem,
  InventoryResult,
  NodeId,
  NodeState,
  OrderTemplate,
  Outcome,
  ReplyDraft,
  RunState,
  TemplateField,
} from "./types";

// ---------------------------------------------------------------------------
// Demo data

export const RFQ_INBOX = "william.ragnarsson+rfq@gmail.com";

export const ORDER_TEMPLATE = templateData as OrderTemplate;

export const STOCK = {
  warehouse: inventoryData.warehouse,
  updated: inventoryData.updated,
  currency: inventoryData.currency,
  items: inventoryData.items as InventoryItem[],
};

export const SELLER = scenariosData.seller;

export const DEMO_SCENARIOS: { id: string; title: string; expectedOutcome: Outcome }[] =
  scenariosData.scenarios.map((s) => ({
    id: s.id,
    title: s.title,
    expectedOutcome: s.expectedOutcome as Outcome,
  }));

export const OUTCOME_LABELS: Record<Outcome, string> = {
  confirmed: "Order confirmation",
  clarify: "Clarifying question",
  unavailable: "Cannot fulfill",
};

/** Simulated timeline (ms after Simulate is clicked). */
const T = {
  emailIn: 800,
  textDone: 2000,
  pdfDone: 3200,
  formDone: 4000,
  stockDone: 4800,
  replyDone: 5600,
};

// ---------------------------------------------------------------------------
// Canned extractions (what GPT reads from the email, what Claude reads from the PDF)

const ex = (key: string, value: string | number | null, quote: string | null): Extraction => ({
  key,
  value,
  quote,
});

interface MockScenario {
  from: string;
  text: Extraction[];
  pdf: Extraction[];
  /** Why a field could not be filled, when the plain "not stated" isn't enough. */
  notes?: Record<string, string>;
}

const MOCK: Record<string, MockScenario> = {
  "1-complete": {
    from: "Laura Chen <laura.chen@ridgewayfab.com>",
    text: [
      ex("customer", "Ridgeway Fabrication", "Purchasing, Ridgeway Fabrication"),
      ex("material", "stainless steel", "304 stainless"),
      ex("grade", "304", "40 sheets of 304 stainless"),
      ex("quantity", 40, "We'd like to order 40 sheets"),
    ],
    pdf: [
      ex("material", "stainless steel", "Stainless steel, AISI 304"),
      ex("grade", "304", "Stainless steel, AISI 304"),
      ex("standard", "ASTM A240", "ASTM A240 / ASME SA240"),
      ex("thickness_in", 0.06, "16 ga (0.060 in)"),
      ex("width_in", 48, "48 in x 96 in"),
      ex("length_in", 96, "48 in x 96 in"),
      ex("finish", "2B", "2B"),
      ex("certification", "EN 10204 3.1", "Mill test report per EN 10204 3.1 required with shipment"),
      ex("country_of_origin", "USA or EU", "Melted and manufactured in USA or EU"),
      ex("delivery_date", "2026-10-30", "2026-10-30"),
    ],
  },
  "2-missing-info": {
    from: "Mark Davies <mark@daviesmarine.co.uk>",
    text: [
      ex("customer", "Davies Marine Works", "Davies Marine Works"),
      ex("grade", "304", "25 sheets of 304 sheet"),
      ex("quantity", 25, "quote 25 sheets"),
    ],
    pdf: [
      ex("material", "stainless steel", "Stainless steel, type 304"),
      ex("grade", "304", "Stainless steel, type 304"),
      ex("standard", "ASTM A240", "ASTM A240"),
      // The spec points at a drawing we don't have, so no value — but keep the words.
      ex("thickness_in", null, "Per drawing D-2231"),
      ex("width_in", 48, "48 x 96 in"),
      ex("length_in", 96, "48 x 96 in"),
      ex("certification", "EN 10204 3.1", "Mill certs (EN 10204 3.1) required"),
    ],
    notes: {
      thickness_in:
        "The PDF only says “Per drawing D-2231” and the drawing is not attached, so we won't guess.",
      finish: "Not stated in the email or the PDF.",
    },
  },
  "3-out-of-stock": {
    from: "Priya Nair <p.nair@coastalfood.com>",
    text: [
      ex("customer", "Coastal Food Equipment", "Head of Procurement, Coastal Food Equipment"),
      ex("grade", "316L", "200 sheets of 316L"),
      ex("quantity", 200, "We need 200 sheets"),
      ex("delivery_date", "within two weeks", "Delivery within two weeks if possible"),
    ],
    pdf: [
      ex("material", "stainless steel", "Stainless steel 316L (UNS S31603)"),
      ex("grade", "316L", "Stainless steel 316L (UNS S31603)"),
      ex("standard", "ASTM A240", "ASTM A240"),
      ex("thickness_in", 0.135, "10 ga (0.135 in)"),
      ex("width_in", 60, "60 in x 120 in"),
      ex("length_in", 120, "60 in x 120 in"),
      ex("finish", "2B", "2B"),
      ex("certification", "EN 10204 3.1", "EN 10204 3.1 mill test certificate for every heat"),
      ex("country_of_origin", "EU or USA", "EU or USA melt only"),
    ],
  },
};

/** One entry per template field, in template order (null where nothing was found). */
function allFields(found: Extraction[]): Extraction[] {
  return ORDER_TEMPLATE.fields.map(
    (f) => found.find((e) => e.key === f.key) ?? ex(f.key, null, null),
  );
}

export function countFound(result: ExtractorResult): number {
  return result.fields.filter((f) => f.value !== null).length;
}

// ---------------------------------------------------------------------------
// Plain code: merge + validate

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
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(String(value)) && !Number.isNaN(Date.parse(String(value)))
        ? null
        : `“${value}” is not a calendar date.`;
    default:
      return String(value).trim() ? null : "Empty value.";
  }
}

/**
 * Fill the order template from both extractions. Rule: the email wins, the PDF
 * fills the gaps; if both state a value and they disagree, it is a conflict.
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

    if (e?.value != null && p?.value != null && !sameValue(e.value, p.value)) {
      return {
        ...base,
        value: e.value,
        source: "email",
        quote: e.quote,
        status: "conflict",
        note: `The email says “${e.value}” but the PDF says “${p.value}”.`,
      };
    }

    const pick = e?.value != null ? e : p?.value != null ? p : null;
    if (!pick || pick.value === null) {
      const hint = p?.quote ? p : e?.quote ? e : null;
      return {
        ...base,
        value: null,
        source: hint ? (hint === p ? "pdf" : "email") : null,
        quote: hint?.quote ?? null,
        status: "missing",
        note: notes[field.key] ?? "Not stated in the email or the PDF.",
      };
    }

    const filled: FilledField = {
      ...base,
      value: pick.value,
      source: pick === e ? "email" : "pdf",
      quote: pick.quote,
      status: "ok",
    };
    const problem = validate(field, pick.value);
    if (problem) {
      filled.status = "invalid";
      filled.note = field.required ? problem : `${problem} Optional, so it doesn't block the order.`;
    }
    return filled;
  });

  const missing = fields.filter((f) => f.required && f.status !== "ok").map((f) => f.label);
  return { templateId: ORDER_TEMPLATE.id, fields, complete: missing.length === 0, missing };
}

// ---------------------------------------------------------------------------
// Plain code: stock lookup

function fieldValue(form: FilledForm, key: string): string | number | null {
  const f = form.fields.find((x) => x.key === key);
  return f && f.status === "ok" ? f.value : null;
}

export function formatMoney(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function checkInventory(form: FilledForm): InventoryResult {
  const v = (key: string) => fieldValue(form, key);
  const requested = Number(v("quantity") ?? 0);
  const match =
    STOCK.items.find(
      (item) =>
        sameValue(item.material, v("material") ?? "") &&
        sameValue(item.grade, v("grade") ?? "") &&
        sameValue(item.standard, v("standard") ?? "") &&
        item.thickness_in === v("thickness_in") &&
        item.width_in === v("width_in") &&
        item.length_in === v("length_in") &&
        sameValue(item.finish, v("finish") ?? ""),
    ) ?? null;

  if (!match) {
    return {
      match: null,
      requested,
      available: 0,
      fulfillable: false,
      total: null,
      reason: "No stock item matches this specification.",
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
// Plain code: reply draft (Thomas approves before anything is sent)

const FINISH_NAMES: Record<string, string> = { "2B": "2B", "#4": "#4 brushed", BA: "BA" };

function listOr(items: string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`;
}

function firstName(from: string): string {
  return from.replace(/<.*>/, "").trim().split(/\s+/)[0] || "there";
}

function question(field: FilledField): string {
  switch (field.key) {
    case "thickness_in":
      return field.quote
        ? `Thickness — your spec says “${field.quote}”${/drawing/i.test(field.quote) ? ", but the drawing wasn't attached" : ""}. What thickness (or gauge) do you need?`
        : "Thickness — what thickness (or gauge) do you need?";
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
  const base = { to: email.from, subject: `Re: ${email.subject}` };

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
      "Unfortunately we don't have sheet matching this specification in stock right now.",
      "We'll check lead times with the mill and get back to you.",
    );
  }
  lines.push("", signature);
  return { ...base, body: lines.join("\n"), outcome: "unavailable" };
}

// ---------------------------------------------------------------------------
// The simulated run

function idleNodes(): Record<NodeId, NodeState> {
  return {
    gmail: { status: "idle" },
    text: { status: "idle" },
    pdf: { status: "idle" },
    template: { status: "idle" },
    inventory: { status: "idle" },
    reply: { status: "idle" },
  };
}

function withNodes(s: RunState, changes: Partial<Record<NodeId, NodeState>>): RunState {
  return { ...s, nodes: { ...s.nodes, ...changes } };
}

function displayName(from: string): string {
  return from.replace(/<.*>/, "").trim() || from;
}

/**
 * Plays a canned run for one demo scenario. `onUpdate` receives a NEW RunState
 * object on every step (the first one synchronously). Returns a cancel function.
 */
export function simulateRun(scenarioId: string, onUpdate: (s: RunState) => void): () => void {
  const scenario =
    scenariosData.scenarios.find((s) => s.id === scenarioId) ?? scenariosData.scenarios[0];
  const mock = MOCK[scenario.id];
  const now = new Date();
  const stamp = now.getTime().toString(36);

  const email: IncomingEmail = {
    id: `mock-${stamp}`,
    threadId: `mock-thread-${stamp}`,
    from: mock.from,
    to: RFQ_INBOX,
    subject: scenario.email.subject,
    body: scenario.email.body,
    receivedAt: now.toISOString(),
    attachment: { filename: scenario.pdf.file, pages: 1 },
  };
  const text: ExtractorResult = {
    source: "email",
    model: MODELS.text.id,
    fields: allFields(mock.text),
    ms: T.textDone - T.emailIn,
  };
  const pdf: ExtractorResult = {
    source: "pdf",
    model: MODELS.pdf.id,
    fields: allFields(mock.pdf),
    ms: T.pdfDone - T.emailIn,
  };
  const form = fillForm(text, pdf, mock.notes);
  const inventory = form.complete ? checkInventory(form) : null;
  const reply = draftReply(email, form, inventory);

  const requiredTotal = form.fields.filter((f) => f.required).length;
  const requiredOk = requiredTotal - form.missing.length;

  let state: RunState = { id: `run-${stamp}`, startedAt: now.toISOString(), nodes: idleNodes() };
  let cancelled = false;
  const timers: ReturnType<typeof setTimeout>[] = [];

  const emit = (next: (s: RunState) => RunState) => {
    if (cancelled) return;
    state = next(state);
    onUpdate(state);
  };
  const at = (ms: number, next: (s: RunState) => RunState) => {
    timers.push(setTimeout(() => emit(next), ms));
  };

  emit((s) => withNodes(s, { gmail: { status: "running", summary: "Checking inbox…" } }));

  at(T.emailIn, (s) =>
    withNodes(
      { ...s, email },
      {
        gmail: { status: "done", summary: `From ${displayName(email.from)}` },
        text: { status: "running", summary: "Reading email…" },
        pdf: { status: "running", summary: "Reading PDF…" },
      },
    ),
  );

  at(T.textDone, (s) =>
    withNodes({ ...s, text }, { text: { status: "done", summary: `${countFound(text)} fields found` } }),
  );

  at(T.pdfDone, (s) =>
    withNodes(
      { ...s, pdf },
      {
        pdf: { status: "done", summary: `${countFound(pdf)} fields found` },
        template: { status: "running", summary: "Filling form…" },
      },
    ),
  );

  at(T.formDone, (s) =>
    withNodes(
      { ...s, form },
      form.complete
        ? {
            template: { status: "done", summary: `${requiredOk}/${requiredTotal} complete` },
            inventory: { status: "running", summary: "Checking stock…" },
          }
        : {
            template: {
              status: "warning",
              summary: `${requiredOk}/${requiredTotal} · ${form.missing.length} missing`,
            },
            inventory: { status: "skipped", summary: "Skipped" },
            reply: { status: "running", summary: "Drafting reply…" },
          },
    ),
  );

  if (inventory) {
    at(T.stockDone, (s) =>
      withNodes(
        { ...s, inventory },
        {
          inventory: inventory.fulfillable
            ? { status: "done", summary: `${inventory.available} in stock` }
            : {
                status: "warning",
                summary: `${inventory.available} of ${inventory.requested} in stock`,
              },
          reply: { status: "running", summary: "Drafting reply…" },
        },
      ),
    );
  }

  at(T.replyDone, (s) =>
    withNodes(
      { ...s, reply },
      {
        reply: {
          status: "awaiting",
          summary: `${OUTCOME_LABELS[reply.outcome]} · awaiting approval`,
        },
      },
    ),
  );

  return () => {
    cancelled = true;
    timers.forEach(clearTimeout);
  };
}

/** "Approve & send" in the demo: only marks the draft as sent in local state. */
export function approveMockReply(state: RunState, sentAt: string): RunState {
  if (!state.reply) return state;
  return withNodes(
    { ...state, reply: { ...state.reply, sentAt } },
    { reply: { status: "done", summary: "Sent" } },
  );
}
