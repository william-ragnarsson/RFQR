// Shared by the live server (live.ts) and the canvas: safe to import in the browser.
import type { RunState } from "./types";

export type LiveStatus =
  | { state: "starting" }
  | { state: "watching"; address: string; since: string; dryRun: boolean }
  | { state: "error"; message: string };

/** Run ids of real (Gmail) runs start with this; simulated ones don't. */
export const LIVE_RUN_PREFIX = "live-";

export type LiveEvent = { type: "status"; status: LiveStatus } | { type: "run"; run: RunState };
