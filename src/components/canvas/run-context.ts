import { createContext, useContext } from "react";
import type { NodeId, NodeState, RunState } from "@/lib/types";

/** Inputs and file types drawn on the canvas to show the roadmap; never part of a run. */
export type RoadmapId = "slack" | "teams" | "upload" | "excel" | "image";

/** What can be open in the detail drawer: a pipeline node, the stock DB or a roadmap node. */
export type Selection = NodeId | "db" | RoadmapId;

interface RunContextValue {
  run: RunState | null;
  selected: Selection | null;
}

/**
 * The live run is shared through context so React Flow's node objects stay
 * static (positions/drag state) while the status and summary update.
 */
export const RunContext = createContext<RunContextValue>({ run: null, selected: null });

export function useRunContext(): RunContextValue {
  return useContext(RunContext);
}

const IDLE: NodeState = { status: "idle" };

export function nodeState(run: RunState | null, id: NodeId): NodeState {
  return run?.nodes[id] ?? IDLE;
}
