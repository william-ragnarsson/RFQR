import { Handle, Position, type Node } from "@xyflow/react";
import type { CSSProperties } from "react";
import { trunkColor } from "./edges";
import { useRunContext } from "./run-context";

export type JunctionNodeType = Node<Record<string, never>, "junction">;

// Both handles sit at the dot's centre, so the lines meet under it.
const CENTRE: CSSProperties = {
  top: "50%",
  left: "50%",
  right: "auto",
  transform: "translate(-50%, -50%)",
  width: 1,
  height: 1,
  minWidth: 0,
  minHeight: 0,
  border: "none",
  opacity: 0,
};

/** Small dot where the inputs merge into one line, or where that line branches out again. */
export function JunctionNode() {
  const { run } = useRunContext();

  return (
    <div className="relative size-2.5">
      <div
        className="size-2.5 rounded-full transition-colors duration-200"
        style={{ background: trunkColor(run) }}
      />
      <Handle type="target" position={Position.Left} isConnectable={false} style={CENTRE} />
      <Handle type="source" position={Position.Right} isConnectable={false} style={CENTRE} />
    </div>
  );
}
