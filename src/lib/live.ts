// Server only: the live demo inside the Next server. One Gmail watcher per server
// process (kept on globalThis so dev hot reloads don't start a second one), started
// by the first canvas that connects. Every RunState update is pushed to all open
// canvases, and a reply is sent only when someone clicks "Approve & send".
//
// Same rules as `npm run watch`: only mail to the +rfq address that arrives after
// the start is read. Don't run both at once, or each RFQ gets two drafts.
// RFQR_DRY_RUN=1 in .env.local turns sending off.

import { getAi, safeErrorMessage } from "./ai/client";
import { getAccountEmail, rfqAddress } from "./gmail/client";
import { sendReply } from "./gmail/send";
import { startRfqWatcher } from "./gmail/watcher";
import { runPipeline } from "./pipeline";
import { replySent } from "./run-steps";
import { LIVE_RUN_PREFIX, type LiveEvent, type LiveStatus } from "./live-types";
import type { RfqMessage, RunState } from "./types";

export type { LiveEvent, LiveStatus } from "./live-types";

interface LiveRun {
  rfq: RfqMessage;
  state: RunState;
  sending: boolean;
}

interface Live {
  status: LiveStatus;
  runs: Map<string, LiveRun>;
  latest: string | null;
  listeners: Set<(e: LiveEvent) => void>;
  started: boolean;
}

const KEY = Symbol.for("rfqr.live");
const g = globalThis as unknown as Record<symbol, Live | undefined>;
const live: Live = (g[KEY] ??= {
  status: { state: "starting" },
  runs: new Map(),
  latest: null,
  listeners: new Set(),
  started: false,
});

const dryRun = () => process.env.RFQR_DRY_RUN === "1";

function broadcast(e: LiveEvent) {
  for (const fn of live.listeners) {
    try {
      fn(e);
    } catch {
      // a closed stream must not break the others
    }
  }
}

function setStatus(status: LiveStatus) {
  live.status = status;
  broadcast({ type: "status", status });
}

function update(runId: string, state: RunState) {
  const run = live.runs.get(runId);
  if (run) run.state = state;
  live.latest = runId;
  broadcast({ type: "run", run: state });
}

async function start() {
  try {
    const address = rfqAddress();
    getAi(); // fail now if the AI key is missing
    await getAccountEmail(); // and if the Gmail token is bad
    const since = new Date();
    startRfqWatcher({
      rfqAddress: address,
      since,
      onRfq: async (rfq) => {
        const runId = `${LIVE_RUN_PREFIX}${Date.now().toString(36)}`;
        live.runs.set(runId, { rfq, state: { id: runId } as RunState, sending: false });
        await runPipeline(rfq, (s) => update(runId, s), { runId });
      },
      onError: (err) => console.error(`[rfqr] watcher error: ${safeErrorMessage(err)}`),
      log: (msg) => console.log(`[rfqr] ${msg}`),
    });
    setStatus({ state: "watching", address, since: since.toISOString(), dryRun: dryRun() });
    console.log(`[rfqr] watching ${address}${dryRun() ? " (dry run: nothing is sent)" : ""}`);
  } catch (err) {
    live.started = false; // the next canvas that connects tries again
    setStatus({ state: "error", message: safeErrorMessage(err) });
  }
}

/** Starts the watcher (once) and subscribes to its events; returns unsubscribe. */
export function subscribe(fn: (e: LiveEvent) => void): () => void {
  live.listeners.add(fn);
  fn({ type: "status", status: live.status });
  const latest = live.latest ? live.runs.get(live.latest) : null;
  if (latest) fn({ type: "run", run: latest.state });
  if (!live.started) {
    live.started = true;
    void start();
  }
  return () => live.listeners.delete(fn);
}

/** Thomas clicked "Approve & send" for this run: send the drafted reply. */
export async function approve(runId: string): Promise<RunState> {
  const run = live.runs.get(runId);
  if (!run) throw new Error("Unknown run (was the server restarted?)");
  const reply = run.state.reply;
  if (!reply) throw new Error("This run has no reply to send");
  if (reply.sentAt) return run.state;
  if (run.sending) throw new Error("Already sending");
  if (dryRun()) throw new Error("Dry run is on (RFQR_DRY_RUN=1): nothing is sent");
  run.sending = true;
  try {
    await sendReply(run.rfq, reply);
    console.log(`[rfqr] reply sent for ${runId}`);
    update(runId, replySent(run.state, new Date().toISOString()));
    return run.state;
  } finally {
    run.sending = false;
  }
}
