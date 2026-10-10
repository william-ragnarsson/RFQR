// Server only (calls the LLM gateway and renders PDFs with MuPDF; never import
// from client components). The real pipeline, one run per RFQ email:
//
//   email in ─┬─ GPT reads the email text ──────┬─ fill the order form ─ stock check ─ reply draft
//             └─ Claude reads the PDF pages ────┘   (plain code, rules.ts)
//
// Every step goes through the same run-steps.ts transitions as the canvas
// simulator, and onUpdate gets a NEW RunState after each one.
//
// It FAILS CLOSED: if a reader fails (or the PDF can't be rendered), that node
// shows the error and the run stops: no form, no reply. A failed read must never
// turn into a clarifying email asking the customer for things they did send.
// Nothing here sends email: sending is a separate step a human approves.

import { getAi, safeErrorMessage } from "./ai/client";
import { extractFromEmail, extractFromPdf } from "./ai/extract";
import { readPdf, type PdfContent } from "./pdf-to-images";
import { checkInventory, draftReply, emptyResult, fillForm } from "./rules";
import {
  emailReceived,
  formFilled,
  newRun,
  pdfDone,
  pdfFailed,
  readersFinished,
  replyDrafted,
  runFailed,
  stockChecked,
  textDone,
  textFailed,
} from "./run-steps";
import { NODE_IDS, type IncomingEmail, type InventoryResult, type NodeId, type RfqMessage, type RunState } from "./types";

/** Pages of a spec sheet that are rendered and read (the demo PDFs have one). */
const MAX_PDF_PAGES = 3;

/**
 * Runs one RFQ from the email to a reply draft awaiting approval. Resolves with
 * the final state (also on failure: then `error` says which node and why) and
 * never rejects. onUpdate is not called again once it has resolved.
 */
export async function runPipeline(
  rfq: Pick<RfqMessage, "email" | "pdf">,
  onUpdate: (s: RunState) => void,
  opts: { runId?: string; now?: () => Date } = {},
): Promise<RunState> {
  const started = (opts.now ?? (() => new Date()))();
  let state = newRun(opts.runId ?? `run-${started.getTime().toString(36)}`, started.toISOString());
  let finished = false;
  const emit = (next: RunState) => {
    if (finished) return;
    state = next;
    try {
      onUpdate(state);
    } catch {
      // A broken listener must not stop the run or make it look failed.
    }
  };

  try {
    emit(state);
    // Render the spec sheet first: the PDF node needs its page count and images.
    let email: IncomingEmail = { ...rfq.email, attachment: null };
    let pdf: PdfContent | null = null;
    if (rfq.pdf) {
      const { filename, data } = rfq.pdf;
      try {
        pdf = await readPdf(data, { maxPages: MAX_PDF_PAGES });
        email = { ...email, attachment: { filename, pages: pdf.pages } };
      } catch (err) {
        email = { ...email, attachment: { filename, pages: 0 } };
        const message = `Could not render ${filename}: ${safeErrorMessage(err)}`;
        emit(runFailed(emailReceived(state, email, { hasPdf: true }), "pdf", message));
        return state;
      }
    }
    emit(emailReceived(state, email, { hasPdf: pdf !== null }));

    // Both readers run in parallel and each shows its result as soon as it has
    // one. If one fails, the run stops once the other has finished too.
    const failures: { node: NodeId; message: string }[] = [];
    const settle = (next: RunState) => {
      if (failures.length === 0 || !readersFinished(next)) return emit(next);
      const message =
        failures.length === 1
          ? failures[0].message
          : failures.map((f) => `${f.node === "pdf" ? "PDF" : "Email"}: ${f.message}`).join("; ");
      emit(runFailed(next, failures[0].node, message));
    };

    const readEmail = extractFromEmail(email).then(
      (text) => settle(textDone(state, text)),
      (err: unknown) => {
        const message = safeErrorMessage(err);
        failures.push({ node: "text", message });
        settle(textFailed(state, message));
      },
    );
    const readSpec = pdf
      ? extractFromPdf({ images: pdf.images, text: pdf.text, filename: email.attachment?.filename ?? "" }).then(
          (result) => settle(pdfDone(state, { ...result, pageImages: pdf.images })),
          (err: unknown) => {
            const message = safeErrorMessage(err);
            failures.push({ node: "pdf", message });
            settle(pdfFailed(state, message));
          },
        )
      : null;
    // allSettled: wait for both, so a bug in one handler can't leave the other unhandled.
    const bug = (await Promise.allSettled([readEmail, readSpec])).find((r) => r.status === "rejected");
    if (bug) throw bug.reason;
    if (state.error || !state.text) return state; // fail closed: no form, no reply

    // Plain code from here on: the AI has no say in what happens next.
    const form = fillForm(state.text, state.pdf ?? emptyResult("pdf", getAi().models.pdf));
    emit(formFilled(state, form));

    let inventory: InventoryResult | null = null;
    if (form.complete) {
      inventory = checkInventory(form);
      emit(stockChecked(state, inventory));
    }

    emit(replyDrafted(state, draftReply(email, form, inventory)));
    return state;
  } catch (err) {
    // A bug in a plain-code step: stop at whichever node was running.
    const node = NODE_IDS.find((id) => state.nodes[id].status === "running") ?? "reply";
    emit(runFailed(state, node, safeErrorMessage(err)));
    return state;
  } finally {
    finished = true;
  }
}
