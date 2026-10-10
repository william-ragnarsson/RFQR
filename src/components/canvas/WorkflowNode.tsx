import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Zap } from "lucide-react";
import type { CSSProperties } from "react";
import { ModelLogo } from "@/components/icons";
import { MODELS } from "@/lib/models";
import type { NodeId, NodeStatus } from "@/lib/types";
import { NODE_META, NodeIcon } from "./node-meta";
import { nodeState, useRunContext } from "./run-context";
import { ModelPill, StatusBadge } from "./status";

export type WorkflowNodeType = Node<Record<string, never>, "workflow">;

// React Flow's stylesheet is unlayered, so it beats Tailwind utilities on the
// handles; inline styles keep the handle shapes predictable.
export const INPUT_HANDLE: CSSProperties = {
  width: 8,
  height: 16,
  borderRadius: 2,
  background: "#9ca3af",
  border: "none",
};

export const OUTPUT_HANDLE: CSSProperties = {
  width: 11,
  height: 11,
  borderRadius: "9999px",
  background: "#9ca3af",
  border: "2px solid #ffffff",
};

/** Diamond port for the Stock DB sub-node (shared with DbNode). */
export const diamondHandle = (side: "top" | "bottom", active: boolean): CSSProperties => ({
  width: 10,
  height: 10,
  borderRadius: 1,
  background: active ? "#6366f1" : "#9ca3af",
  border: "none",
  transform: `translate(-50%, ${side === "top" ? "-50%" : "50%"}) rotate(45deg)`,
});

const BORDER: Record<NodeStatus, string> = {
  idle: "border-gray-300",
  running: "border-indigo-500",
  done: "border-green-500",
  warning: "border-amber-500",
  error: "border-red-500",
  skipped: "border-dashed border-gray-400",
  awaiting: "border-indigo-500",
};

const SUMMARY_COLOR: Record<NodeStatus, string> = {
  idle: "text-gray-400",
  running: "text-indigo-600",
  done: "text-gray-600",
  warning: "text-amber-700",
  error: "text-red-600",
  skipped: "text-gray-400",
  awaiting: "text-indigo-700",
};

export function WorkflowNode({ id: rawId }: NodeProps<WorkflowNodeType>) {
  const id = rawId as NodeId;
  const { run, selected } = useRunContext();
  const { status, summary } = nodeState(run, id);
  const meta = NODE_META[id];
  const model = meta.model ? MODELS[meta.model] : null;
  const isTrigger = id === "gmail";

  return (
    <div className={`relative size-24 ${status === "skipped" ? "opacity-40" : ""}`}>
      {isTrigger && (
        <Zap
          size={18}
          className="absolute top-1/2 -left-7 -translate-y-1/2 fill-orange-500 text-orange-500"
          aria-label="Trigger"
        />
      )}

      <div
        className={`relative flex size-24 cursor-pointer items-center justify-center border-[1.5px] bg-white shadow-xs transition-[border-color,box-shadow] duration-200 ${
          isTrigger ? "rounded-l-[40px] rounded-r-2xl" : "rounded-2xl"
        } ${BORDER[status]} ${selected === id ? "ring-4 ring-indigo-100" : "hover:shadow-md"}`}
      >
        {status === "running" && (
          <span
            aria-hidden="true"
            className="animate-pulse-ring pointer-events-none absolute -inset-1.5 rounded-[inherit] border-2 border-indigo-400"
          />
        )}

        <NodeIcon id={id} size={40} />

        {model && (
          <span
            className="absolute -top-3 -right-3 flex size-7 items-center justify-center rounded-full border border-gray-200 bg-white shadow-sm"
            title={`Read by ${model.name}`}
          >
            <ModelLogo provider={model.provider} size={16} />
          </span>
        )}

        <StatusBadge status={status} />
      </div>

      {!isTrigger && (
        <Handle type="target" position={Position.Left} isConnectable={false} style={INPUT_HANDLE} />
      )}
      {id !== "reply" && (
        <Handle type="source" position={Position.Right} isConnectable={false} style={OUTPUT_HANDLE} />
      )}
      {id === "inventory" && (
        <Handle
          id="db"
          type="target"
          position={Position.Bottom}
          isConnectable={false}
          style={diamondHandle("bottom", status === "running")}
        />
      )}

      <div className="absolute top-full left-1/2 mt-2 flex w-max max-w-[236px] -translate-x-1/2 flex-col items-center rounded-md bg-white px-1 text-center leading-tight">
        <span className="text-sm font-medium text-gray-800">{meta.label}</span>
        <span className="text-xs text-gray-500">{meta.subtitle}</span>
        {model && (
          <span className="mt-1">
            <ModelPill model={model} />
          </span>
        )}
        <span className={`mt-0.5 h-4 max-w-full truncate text-xs ${SUMMARY_COLOR[status]}`}>
          {summary ?? ""}
        </span>
      </div>
    </div>
  );
}
