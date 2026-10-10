/**
 * Terminal output shared by scripts/run-local.ts and scripts/watch.ts: a live
 * timeline of node changes while a run is going, then the filled form, the
 * stock check and the reply draft.
 *
 * Email text comes from outside senders, so everything printed goes through
 * clean(): no escape sequences can reach the terminal (they could fake output).
 */
import { OUTCOME_LABELS, STOCK, formatMoney } from "../../src/lib/rules";
import { NODE_IDS, type NodeId, type NodeState, type RunState } from "../../src/lib/types";

export const NODE_LABELS: Record<NodeId, string> = {
  gmail: "Gmail",
  text: "Email (GPT)",
  pdf: "PDF (Claude)",
  template: "Order form",
  inventory: "Inventory",
  reply: "Reply",
};

/**
 * Control characters (ESC included) and invisible bidi/zero-width marks (which
 * can reorder what is shown, e.g. an address) removed; newlines kept only if asked.
 */
export function clean(text: string, opts?: { multiline?: boolean }): string {
  const out = text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g, " ");
  return opts?.multiline ? out : out.replace(/\n/g, " ");
}

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

/**
 * Returns an onUpdate callback that prints one line per node change, with the
 * time since the run started: "  +1.3 s  Email (GPT)   done      4 fields found".
 */
export function timeline(log: (line: string) => void = console.log): (s: RunState) => void {
  const t0 = Date.now();
  let prev: Record<NodeId, NodeState> | null = null;
  return (s) => {
    const at = `+${seconds(Date.now() - t0)}`.padStart(8);
    for (const id of NODE_IDS) {
      const node = s.nodes[id];
      const before = prev?.[id];
      if (before ? before.status === node.status && before.summary === node.summary : node.status === "idle") {
        continue;
      }
      // The readers also show which model answered and how long it took.
      const result = id === "text" ? s.text : id === "pdf" ? s.pdf : undefined;
      const extra = node.status === "done" && result ? `  (${result.model}, ${seconds(result.ms)})` : "";
      log(`${at}  ${NODE_LABELS[id].padEnd(13)} ${node.status.padEnd(9)} ${clean(node.summary ?? "")}${extra}`);
    }
    prev = s.nodes;
  };
}

/** A plain text table; every cell is cut to its column's max width. */
function table(head: string[], rows: string[][], max: number[]): string[] {
  const cells = [head, ...rows].map((row) => row.map((c, i) => cut(clean(c), max[i])));
  const widths = head.map((_, i) => Math.max(...cells.map((row) => row[i].length)));
  const line = (row: string[]) => `  ${row.map((c, i) => c.padEnd(widths[i])).join("  ")}`.trimEnd();
  return [line(cells[0]), line(widths.map((w) => "-".repeat(w))), ...cells.slice(1).map(line)];
}

function verifiedLabel(v: boolean | null | undefined): string {
  return v === true ? "yes" : v === false ? "NO" : "-";
}

/** The outcome of a finished run: the form, the stock check and the reply (or why it stopped). */
export function printResult(s: RunState, log: (line: string) => void = console.log): void {
  if (s.form) {
    log("");
    log("Order Intake Form");
    const rows = s.form.fields.map((f) => [
      `${f.label}${f.required ? "" : " (opt.)"}`,
      f.value === null ? "-" : String(f.value),
      f.source ?? "-",
      verifiedLabel(f.verified),
      f.status,
      f.quote === null ? "" : `“${f.quote}”`,
    ]);
    for (const line of table(["Field", "Value", "Source", "Verified", "Status", "Quote"], rows, [26, 24, 6, 8, 8, 50])) {
      log(line);
    }
    for (const f of s.form.fields.filter((x) => x.status !== "ok" && x.note)) {
      log(`  ! ${f.label}: ${clean(f.note ?? "")}`);
    }
    // verified null on a used value: it came from a PDF without a text layer (e.g. a scan).
    const unchecked = s.form.fields.filter((f) => f.status === "ok" && f.value !== null && f.verified === null);
    if (unchecked.length) {
      log(`  ! Not checked word for word (the PDF has no text layer): ${unchecked.map((f) => f.label).join(", ")}.`);
      log("    Compare these with the PDF before approving the reply.");
    }
  }

  if (s.inventory) {
    const inv = s.inventory;
    log("");
    log("Stock check");
    if (inv.match) {
      log(`  ${inv.match.sku} · ${inv.match.description}`);
      log(`  requested ${inv.requested} · on hand ${inv.available} · ${inv.fulfillable ? "can fulfil" : "CANNOT fulfil"}`);
      if (inv.total !== null) log(`  total ${formatMoney(inv.total)} ${STOCK.currency}`);
    }
    log(`  ${inv.reason}`);
  } else if (s.form) {
    log("");
    log(`Stock check skipped: the form is incomplete (${s.form.missing.join(", ")}).`);
  }

  if (s.reply) {
    log("");
    log(`Reply draft · ${OUTCOME_LABELS[s.reply.outcome]}${s.reply.sentAt ? " · sent" : " · awaiting approval"}`);
    log(`  To:      ${clean(s.reply.to)}`);
    log(`  Subject: ${clean(s.reply.subject)}`);
    log("  " + "-".repeat(60));
    for (const line of clean(s.reply.body, { multiline: true }).split("\n")) log(`  | ${line}`.trimEnd());
    log("  " + "-".repeat(60));
  }

  if (s.error) {
    log("");
    log(`Run FAILED at ${NODE_LABELS[s.error.node]}: ${clean(s.error.message)}`);
    log("The run stopped there on purpose: no reply was drafted and nothing was sent.");
  }
}
