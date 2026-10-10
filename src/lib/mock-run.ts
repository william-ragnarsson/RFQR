// Simulated pipeline run for the canvas demo. No network, no AI calls.
//
// Only the two "AI" steps are canned: the extractions below are what the models
// are expected to return for the demo emails/PDFs (every quote is an exact
// substring of the email body or of a PDF row value). Everything after that —
// merging, validation, the stock lookup and the reply draft — is the same plain
// code (rules.ts) and the same node transitions (run-steps.ts) as the real pipeline.

import scenariosData from "../../data/demo/scenarios.json";
import { MODELS } from "./models";
import { RFQ_INBOX, checkInventory, completeFields, draftReply, fillForm } from "./rules";
import {
  emailReceived,
  formFilled,
  newRun,
  pdfDone,
  replyDrafted,
  replySent,
  stockChecked,
  textDone,
} from "./run-steps";
import type { Extraction, ExtractorResult, IncomingEmail, Outcome, RunState } from "./types";

export const DEMO_SCENARIOS: { id: string; title: string; expectedOutcome: Outcome }[] =
  scenariosData.scenarios.map((s) => ({
    id: s.id,
    title: s.title,
    expectedOutcome: s.expectedOutcome as Outcome,
  }));

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
  text: Extraction[];
  pdf: Extraction[];
  /** Why a field could not be filled, when the plain "not stated" isn't enough. */
  notes?: Record<string, string>;
}

const MOCK: Record<string, MockScenario> = {
  "1-complete": {
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

// ---------------------------------------------------------------------------
// The simulated run

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
    from: scenario.email.from,
    to: RFQ_INBOX,
    subject: scenario.email.subject,
    body: scenario.email.body,
    receivedAt: now.toISOString(),
    attachment: { filename: scenario.pdf.file, pages: 1 },
  };
  const text: ExtractorResult = {
    source: "email",
    model: MODELS.text.id,
    fields: completeFields(mock.text),
    ms: T.textDone - T.emailIn,
  };
  const pdf: ExtractorResult = {
    source: "pdf",
    model: MODELS.pdf.id,
    fields: completeFields(mock.pdf),
    ms: T.pdfDone - T.emailIn,
  };
  const form = fillForm(text, pdf, mock.notes);
  const inventory = form.complete ? checkInventory(form) : null;
  const reply = draftReply(email, form, inventory);

  let state = newRun(`run-${stamp}`, now.toISOString());
  let cancelled = false;
  const timers: ReturnType<typeof setTimeout>[] = [];

  const at = (ms: number, next: (s: RunState) => RunState) => {
    timers.push(
      setTimeout(() => {
        if (cancelled) return;
        state = next(state);
        onUpdate(state);
      }, ms),
    );
  };

  onUpdate(state);
  at(T.emailIn, (s) => emailReceived(s, email, { hasPdf: true }));
  at(T.textDone, (s) => textDone(s, text));
  at(T.pdfDone, (s) => pdfDone(s, pdf));
  at(T.formDone, (s) => formFilled(s, form));
  if (inventory) at(T.stockDone, (s) => stockChecked(s, inventory));
  at(T.replyDone, (s) => replyDrafted(s, reply));

  return () => {
    cancelled = true;
    timers.forEach(clearTimeout);
  };
}

/** "Approve & send" in the demo: only marks the draft as sent in local state. */
export function approveMockReply(state: RunState, sentAt: string): RunState {
  return replySent(state, sentAt);
}
