import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Zap } from "lucide-react";
import { NODE_META, NodeIcon, ROADMAP_INPUTS } from "./node-meta";
import { useRunContext, type RoadmapId } from "./run-context";
import { INPUT_HANDLE, OUTPUT_HANDLE } from "./WorkflowNode";

export type RoadmapNodeType = Node<Record<string, never>, "roadmap">;

const GHOST_INPUT = { ...INPUT_HANDLE, background: "#d1d5db" };
const GHOST_OUTPUT = { ...OUTPUT_HANDLE, background: "#d1d5db" };

/** A smaller, dashed node for an input or file type that is on the roadmap. Never part of a run. */
export function RoadmapNode({ id: rawId }: NodeProps<RoadmapNodeType>) {
  const id = rawId as RoadmapId;
  const { selected } = useRunContext();
  const meta = NODE_META[id];
  const isTrigger = ROADMAP_INPUTS.includes(id);

  return (
    <div className="relative size-16">
      {isTrigger && (
        <Zap
          size={14}
          className="absolute top-1/2 -left-6 -translate-y-1/2 fill-gray-300 text-gray-300"
          aria-label="Trigger"
        />
      )}

      <div
        className={`relative flex size-16 cursor-pointer items-center justify-center border-[1.5px] border-dashed border-gray-300 bg-white transition-shadow duration-200 ${
          isTrigger ? "rounded-l-[28px] rounded-r-xl" : "rounded-xl"
        } ${selected === id ? "ring-4 ring-indigo-100" : "hover:shadow-md"}`}
      >
        <span className="flex opacity-60">
          <NodeIcon id={id} size={26} />
        </span>
        <span className="absolute -top-2.5 -right-3 rounded-full border border-gray-200 bg-white px-1.5 py-px text-[10px] font-medium text-gray-500 shadow-xs">
          Soon
        </span>
      </div>

      {!isTrigger && (
        <Handle type="target" position={Position.Left} isConnectable={false} style={GHOST_INPUT} />
      )}
      <Handle type="source" position={Position.Right} isConnectable={false} style={GHOST_OUTPUT} />

      <div className="absolute top-full left-1/2 mt-1.5 flex w-max -translate-x-1/2 flex-col items-center text-center leading-tight">
        <span className="text-xs font-medium text-gray-500">{meta.label}</span>
        <span className="text-[11px] text-gray-400">{meta.subtitle}</span>
      </div>
    </div>
  );
}
