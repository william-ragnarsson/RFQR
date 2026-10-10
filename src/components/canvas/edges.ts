import { MarkerType, type Edge } from "@xyflow/react";
import type { NodeId, NodeStatus, RunState } from "@/lib/types";
import { ROADMAP_INPUTS, ROADMAP_READERS } from "./node-meta";
import { nodeState } from "./run-context";

/** The two junction points: every input merges into one line, which then branches out to the readers. */
export const MERGE = "merge";
export const SPLIT = "split";

const FLOW: [NodeId, NodeId][] = [
  ["text", "template"],
  ["pdf", "template"],
  ["template", "inventory"],
  ["inventory", "reply"],
];

const INDIGO = "#6366f1";
const DARK = "#6b7280";
const LIGHT = "#d1d5db";
const FINISHED: NodeStatus[] = ["done", "warning", "awaiting", "error"];

const arrow = (color: string) => ({ type: MarkerType.ArrowClosed, width: 16, height: 16, color });

function edgeColor(from: NodeStatus, to: NodeStatus): string {
  if (to === "running") return INDIGO;
  const skipped = from === "skipped" || to === "skipped";
  return !skipped && FINISHED.includes(to) ? DARK : LIGHT;
}

function liveEdge(source: string, target: string, from: NodeStatus, to: NodeStatus, withArrow = true): Edge {
  const color = edgeColor(from, to);
  const skipped = from === "skipped" || to === "skipped";
  return {
    id: `${source}-${target}`,
    source,
    target,
    animated: to === "running",
    style: {
      stroke: color,
      strokeWidth: 1.5,
      ...(skipped ? { strokeDasharray: "4 4" } : {}),
    },
    ...(withArrow ? { markerEnd: arrow(color) } : {}),
  };
}

/** Roadmap edges stay light and dashed: nothing flows through them yet. */
function roadmapEdge(source: string, target: string, withArrow = true): Edge {
  return {
    id: `${source}-${target}`,
    source,
    target,
    style: { stroke: LIGHT, strokeWidth: 1.5, strokeDasharray: "4 4" },
    ...(withArrow ? { markerEnd: arrow(LIGHT) } : {}),
  };
}

/** The merged line carries the email to both readers, so it is as far along as the furthest one. */
function readersStatus(run: RunState | null): NodeStatus {
  const readers = [nodeState(run, "text").status, nodeState(run, "pdf").status];
  if (readers.includes("running")) return "running";
  if (readers.some((s) => FINISHED.includes(s))) return "done";
  if (readers.every((s) => s === "skipped")) return "skipped";
  return "idle";
}

/** Colour of the merged line (and of its two junction dots). */
export function trunkColor(run: RunState | null): string {
  return edgeColor(nodeState(run, "gmail").status, readersStatus(run));
}

export function buildEdges(run: RunState | null): Edge[] {
  const status = (id: NodeId) => nodeState(run, id).status;
  const gmail = status("gmail");
  const readers = readersStatus(run);

  // Roadmap edges first, so the live ones are drawn on top where they meet.
  const edges: Edge[] = [
    ...ROADMAP_INPUTS.map((id) => roadmapEdge(id, MERGE, false)),
    ...ROADMAP_READERS.flatMap((id) => [roadmapEdge(SPLIT, id), roadmapEdge(id, "template")]),
    liveEdge("gmail", MERGE, gmail, readers, false),
    { ...liveEdge(MERGE, SPLIT, gmail, readers, false), type: "straight" },
    liveEdge(SPLIT, "text", gmail, status("text")),
    liveEdge(SPLIT, "pdf", gmail, status("pdf")),
    ...FLOW.map(([source, target]) => liveEdge(source, target, status(source), status(target))),
  ];

  const inventoryRunning = status("inventory") === "running";
  edges.push({
    id: "db-inventory",
    source: "db",
    sourceHandle: "db",
    target: "inventory",
    targetHandle: "db",
    type: "straight",
    animated: inventoryRunning,
    style: { stroke: inventoryRunning ? INDIGO : "#9ca3af", strokeWidth: 1.5, strokeDasharray: "5 5" },
  });

  return edges;
}
