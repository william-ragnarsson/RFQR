import { createContext, useContext } from "react";
import type { NodeId, NodeState, RunState } from "@/lib/types";

/** What can be open in the detail drawer: a pipeline node or the stock DB. */
export type Selection = NodeId | "db";

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
