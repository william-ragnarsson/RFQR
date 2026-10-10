/**
 * The live demo: watches the RFQ address in Gmail, runs the real pipeline on
 * every new RFQ email and asks on the terminal before each reply is sent.
 *
 *   npm run watch [-- --since <minutes>] [--dry-run]
 *
 * Only mail delivered to RFQ_ADDRESS that arrived after the start (minus
 * --since minutes, default 0) is read; the rest of the inbox is never looked at.
 * A reply is sent only when you answer "y" at the prompt. With --dry-run, or
 * when stdin is not a terminal, nothing is ever sent. RFQs that arrive while a
 * question is open wait their turn. Ctrl+C stops.
 */
import { createInterface, type Interface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { getAi } from "../src/lib/ai/client";
import { GmailError, getAccountEmail, rfqAddress } from "../src/lib/gmail/client";
import { parseAddresses } from "../src/lib/gmail/inbox";
import { sendReply } from "../src/lib/gmail/send";
import { startRfqWatcher } from "../src/lib/gmail/watcher";
import { runPipeline } from "../src/lib/pipeline";
import { replySent } from "../src/lib/run-steps";
import type { RfqMessage } from "../src/lib/types";
import { clean, printResult, timeline } from "./lib/print";

/** Input that arrives this soon after the question was typed BEFORE it: ignored. */
const TYPE_AHEAD_MS = 300;

let watcher: { stop(): void } | null = null;
let asking: Interface | null = null;

function parseCli(): { sinceMinutes: number; dryRun: boolean } {
  const { values } = parseArgs({
    options: { since: { type: "string" }, "dry-run": { type: "boolean", default: false } },
  });
  const sinceMinutes = values.since === undefined ? 0 : Number(values.since);
  if (!Number.isFinite(sinceMinutes) || sinceMinutes < 0) {
    throw new Error(`--since takes a number of minutes, got "${values.since}"`);
  }
  return { sinceMinutes, dryRun: values["dry-run"] ?? false };
}

/** Error messages only (Gmail and pipeline errors are secret-free); never raw error objects. */
function errorMessage(err: unknown): string {
  return clean(err instanceof Error ? err.message : String(err));
}

function shutdown() {
  watcher?.stop();
  const pending = asking !== null;
  asking?.close();
  console.log(pending ? "\nStopped. The reply waiting for approval was NOT sent." : "\nStopped watching.");
  process.exit(0);
}

/**
 * Asks on the terminal; true only for an explicit "y" or "yes". Enter, anything
 * else or end of input means no. Anything typed before the question appeared
 * (e.g. while the pipeline was running), with or without Enter, doesn't count.
 */
async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  asking = rl;
  rl.on("SIGINT", shutdown); // while readline reads, Ctrl+C reaches it instead of the process
  const askedAt = Date.now();
  // A half-typed line from before the question shows up in the prompt once readline
  // starts reading: wipe it, so Enter alone can never send an earlier "y".
  const wipe = setTimeout(() => {
    if (rl.line) {
      rl.write(null, { ctrl: true, name: "e" }); // cursor to end of line
      rl.write(null, { ctrl: true, name: "u" }); // delete to start of line
    }
  }, TYPE_AHEAD_MS);
  try {
    const answer = await new Promise<string | null>((resolve) => {
      rl.on("line", (line) => {
        if (Date.now() - askedAt < TYPE_AHEAD_MS) {
          rl.prompt(); // typed ahead: ask again
          return;
        }
        resolve(line);
      });
      rl.once("close", () => resolve(null));
      rl.setPrompt(question);
      rl.prompt();
    });
    return answer !== null && /^(y|yes)$/i.test(answer.trim());
  } finally {
    clearTimeout(wipe);
    asking = null;
    rl.close();
  }
}

async function handleRfq(rfq: RfqMessage, dryRun: boolean) {
  const { email, pdf } = rfq;
  console.log(`\n${"=".repeat(72)}`);
  console.log(
    `New RFQ from ${clean(email.from)}: ${clean(email.subject)} (PDF: ${pdf ? clean(pdf.filename) : "none"})\n`,
  );

  const onUpdate = timeline();
  const final = await runPipeline(rfq, onUpdate);
  printResult(final);

  const reply = final.reply;
  console.log("");
  if (!reply) return console.log("Nothing was sent.");
  if (dryRun) return console.log("Not sent: --dry-run is on.");
  if (!process.stdin.isTTY) return console.log("Not sent: stdin is not a terminal, so nobody can approve it.");

  // The bare address only: a display name could be made to look like another address.
  const [to] = parseAddresses(reply.to);
  if (!(await confirm(`Send this reply to ${clean(to ?? reply.to)}? [y/N] `))) {
    return console.log("Not sent (only an explicit y sends).");
  }
  try {
    const sent = await sendReply(rfq, reply);
    onUpdate(replySent(final, new Date().toISOString()));
    console.log(`Sent in thread ${sent.threadId}`);
  } catch (err) {
    console.log(`NOT sent: ${errorMessage(err)}`);
  }
}

async function main() {
  const { sinceMinutes, dryRun } = parseCli();
  const address = rfqAddress();
  const ai = getAi(); // fails now, not on the first RFQ, if NICRRON_API_KEY is missing
  const account = await getAccountEmail(); // also checks the Gmail token
  const since = new Date(Date.now() - sinceMinutes * 60_000);

  console.log("RFQR watcher");
  console.log(`  Account:  ${account}`);
  console.log(`  Watching: ${address} (only mail to this address is read)`);
  console.log(`  Since:    ${since.toLocaleString()} (${sinceMinutes ? `${sinceMinutes} min ago` : "now"})`);
  console.log(`  Readers:  ${ai.models.text} (email), ${ai.models.pdf} (PDF)`);
  console.log(`  Dry run:  ${dryRun ? "ON, replies are never sent" : "off, every reply asks you before it is sent"}`);
  console.log("\nWaiting for RFQ emails… (Ctrl+C to stop)");

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  watcher = startRfqWatcher({
    rfqAddress: address,
    since,
    onRfq: (rfq) => handleRfq(rfq, dryRun),
    onError: (err) => console.error(`Watcher error: ${errorMessage(err)}`),
    log: (msg) => console.log(`  [gmail] ${clean(msg)}`),
  });
}

main().catch((err) => {
  const auth = err instanceof GmailError && err.authFailed;
  console.error(`${auth ? "Gmail authentication failed" : "Error"}: ${errorMessage(err)}`);
  process.exit(1);
});
