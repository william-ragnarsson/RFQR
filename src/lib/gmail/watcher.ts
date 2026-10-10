// Server only: the "Gmail trigger". Polls the inbox for new RFQ emails and hands
// them to the pipeline one at a time, oldest first.
//
// Read-only: no labels, no "mark as read". Processed ids are remembered in memory
// only, so a restart starts over from its own `since` (pass the start time).
// A failing message is reported through onError and never stops the watcher.

import type { RfqMessage } from "../types";
import { fetchRfq, listNewRfqIds } from "./inbox";

const MAX_BACKOFF_MS = 30_000;
/** Fetch attempts per message before it is given up on (a transient error gets retried). */
const MAX_FETCH_ATTEMPTS = 3;

export function startRfqWatcher(opts: {
  rfqAddress: string;
  since: Date;
  pollMs?: number;
  onRfq: (rfq: RfqMessage) => Promise<void>;
  onError?: (err: unknown) => void;
  log?: (msg: string) => void;
}): { stop(): void } {
  const pollMs = Math.max(1000, opts.pollMs ?? 5000);
  const log = opts.log ?? (() => {});
  const reportError = (err: unknown) => {
    try {
      opts.onError?.(err);
    } catch {
      // an error handler must not kill the watcher
    }
  };

  const seen = new Set<string>(); // handed to onRfq, given up on or not an RFQ: never looked at again
  const fetchAttempts = new Map<string, number>();
  let failures = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  // One cycle: find new RFQs, process them strictly one after another, then wait.
  // Mail that arrives meanwhile is picked up by the next cycle.
  async function cycle() {
    timer = null;
    let delay = pollMs;
    try {
      const fresh = await listNewRfqIds({
        rfqAddress: opts.rfqAddress,
        since: opts.since,
        skipIds: seen,
        onRejected: (id) => seen.add(id), // not an RFQ (or too old): don't look at it again
      });
      failures = 0;
      if (fresh.length) log(`${fresh.length} RFQ email(s) to process`);

      for (const { id } of fresh) {
        if (stopped) break;
        let rfq: RfqMessage;
        try {
          rfq = await fetchRfq(id, opts.rfqAddress, { log });
        } catch (err) {
          const attempts = (fetchAttempts.get(id) ?? 0) + 1;
          fetchAttempts.set(id, attempts);
          log(`could not read message ${id} (attempt ${attempts}/${MAX_FETCH_ATTEMPTS})`);
          reportError(err);
          if (attempts < MAX_FETCH_ATTEMPTS) break; // retry next cycle, keeping arrival order
          seen.add(id); // give up on this one
          continue;
        }

        seen.add(id);
        fetchAttempts.delete(id);
        log(`processing message ${id}`);
        try {
          await opts.onRfq(rfq);
        } catch (err) {
          reportError(err);
        }
      }
    } catch (err) {
      failures++;
      delay = Math.min(MAX_BACKOFF_MS, pollMs * 2 ** failures);
      log(`polling Gmail failed, retrying in ${Math.round(delay / 1000)} s`);
      reportError(err);
    }
    if (!stopped) timer = setTimeout(cycle, delay);
  }

  log(`watching ${opts.rfqAddress} for mail after ${opts.since.toISOString()}`);
  timer = setTimeout(cycle, 0);

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
