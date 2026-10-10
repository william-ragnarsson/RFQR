// Node-state transitions shared by the canvas simulator and the real pipeline,
// so both show exactly the same node summaries. One function per pipeline
// event; each takes the current RunState and returns a NEW one (never mutates),
// ready to hand to an onUpdate(RunState) callback.

import { OUTCOME_LABELS, countFound, senderName } from "./rules";
import type {
  ExtractorResult,
  FilledForm,
  IncomingEmail,
  InventoryResult,
  NodeId,
  NodeState,
  NodeStatus,
  ReplyDraft,
  RunState,
} from "./types";

export function idleNodes(): Record<NodeId, NodeState> {
  return {
    gmail: { status: "idle" },
    text: { status: "idle" },
    pdf: { status: "idle" },
    template: { status: "idle" },
    inventory: { status: "idle" },
    reply: { status: "idle" },
  };
}

export function withNodes(s: RunState, changes: Partial<Record<NodeId, NodeState>>): RunState {
  return { ...s, nodes: { ...s.nodes, ...changes } };
}

/** "Laura Chen <laura@…>" → "Laura Chen"; a bare address stays as it is. */
export function displayName(from: string): string {
  return senderName(from) || from;
}

/** One short line for a node summary (the drawer and the terminal keep the details). */
function shortMessage(message: string): string {
  const line = message.trim().split("\n")[0] || "Failed";
  return line.length > 60 ? `${line.slice(0, 59)}…` : line;
}

const OPEN: NodeStatus[] = ["idle", "running"];

/** Both readers have finished (done, failed or skipped): the template can start. */
export function readersFinished(s: RunState): boolean {
  return !OPEN.includes(s.nodes.text.status) && !OPEN.includes(s.nodes.pdf.status);
}

function startTemplateIfReady(s: RunState): RunState {
  return readersFinished(s)
    ? withNodes(s, { template: { status: "running", summary: "Filling form…" } })
    : s;
}

// ---------------------------------------------------------------------------
// Events, in pipeline order

export function newRun(id: string, startedAt: string): RunState {
  return {
    id,
    startedAt,
    nodes: { ...idleNodes(), gmail: { status: "running", summary: "Checking inbox…" } },
  };
}

export function emailReceived(
  s: RunState,
  email: IncomingEmail,
  opts: { hasPdf: boolean },
): RunState {
  return withNodes(
    { ...s, email },
    {
      gmail: { status: "done", summary: `From ${displayName(email.from)}` },
      text: { status: "running", summary: "Reading email…" },
      pdf: opts.hasPdf
        ? { status: "running", summary: "Reading PDF…" }
        : { status: "skipped", summary: "No PDF attached" },
    },
  );
}

// The two readers run in parallel: whichever finishes last starts the template.

export function textDone(s: RunState, text: ExtractorResult): RunState {
  return startTemplateIfReady(
    withNodes({ ...s, text }, { text: { status: "done", summary: `${countFound(text)} fields found` } }),
  );
}

export function textFailed(s: RunState, message: string): RunState {
  return startTemplateIfReady(
    withNodes(s, { text: { status: "error", summary: shortMessage(message) } }),
  );
}

export function pdfDone(s: RunState, pdf: ExtractorResult & { pageImages?: string[] }): RunState {
  return startTemplateIfReady(
    withNodes({ ...s, pdf }, { pdf: { status: "done", summary: `${countFound(pdf)} fields found` } }),
  );
}

export function pdfFailed(s: RunState, message: string): RunState {
  return startTemplateIfReady(
    withNodes(s, { pdf: { status: "error", summary: shortMessage(message) } }),
  );
}

export function formFilled(s: RunState, form: FilledForm): RunState {
  const requiredTotal = form.fields.filter((f) => f.required).length;
  const requiredOk = requiredTotal - form.missing.length;
  return withNodes(
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
  );
}

export function stockChecked(s: RunState, inventory: InventoryResult): RunState {
  return withNodes(
    { ...s, inventory },
    {
      inventory: inventory.fulfillable
        ? { status: "done", summary: `${inventory.available} in stock` }
        : { status: "warning", summary: `${inventory.available} of ${inventory.requested} in stock` },
      reply: { status: "running", summary: "Drafting reply…" },
    },
  );
}

export function replyDrafted(s: RunState, reply: ReplyDraft): RunState {
  return withNodes(
    { ...s, reply },
    { reply: { status: "awaiting", summary: `${OUTCOME_LABELS[reply.outcome]} · awaiting approval` } },
  );
}

/** Thomas approved and the reply went out (or, in the simulator, pretends to). */
export function replySent(s: RunState, sentAt: string): RunState {
  if (!s.reply) return s;
  return withNodes(
    { ...s, reply: { ...s.reply, sentAt } },
    { reply: { status: "done", summary: "Sent" } },
  );
}

/**
 * The run stopped at `node`: that node shows the error, and every node that was
 * still idle or running is marked "skipped" (nothing after a stop will run).
 * Finished nodes keep their state, so the canvas still shows what was done.
 * The full message is kept in `error`.
 */
export function runFailed(s: RunState, node: NodeId, message: string): RunState {
  const changes: Partial<Record<NodeId, NodeState>> = {};
  for (const [id, state] of Object.entries(s.nodes) as [NodeId, NodeState][]) {
    if (OPEN.includes(state.status)) changes[id] = { status: "skipped", summary: "Skipped" };
  }
  changes[node] = { status: "error", summary: shortMessage(message) };
  return withNodes({ ...s, error: { node, message } }, changes);
}
