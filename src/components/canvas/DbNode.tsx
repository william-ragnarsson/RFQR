import { Handle, Position, type Node } from "@xyflow/react";
import { Database } from "lucide-react";
import { STOCK } from "@/lib/mock-run";
import { nodeState, useRunContext } from "./run-context";
import { diamondHandle } from "./WorkflowNode";

export type DbNodeType = Node<Record<string, never>, "db">;

/** Small round sub-node: the stock database the inventory check reads from. */
export function DbNode() {
  const { run, selected } = useRunContext();
  const inventory = nodeState(run, "inventory").status;
  const active = inventory === "running";
  const used = inventory === "done" || inventory === "warning";

  return (
    <div className={`relative size-16 ${inventory === "skipped" ? "opacity-40" : ""}`}>
      <div
        className={`flex size-16 cursor-pointer items-center justify-center rounded-full border-[1.5px] bg-white shadow-xs transition-colors duration-200 ${
          active ? "border-indigo-500" : used ? "border-gray-400" : "border-gray-300"
        } ${selected === "db" ? "ring-4 ring-indigo-100" : "hover:shadow-md"}`}
      >
        <Database size={26} strokeWidth={1.5} className="text-gray-600" />
      </div>

      <Handle
        id="db"
        type="source"
        position={Position.Top}
        isConnectable={false}
        style={diamondHandle("top", active)}
      />

      <div className="absolute top-full left-1/2 mt-1.5 flex w-max -translate-x-1/2 flex-col items-center text-center leading-tight">
        <span className="text-xs font-medium text-gray-800">Stock DB</span>
        <span className="text-[11px] text-gray-500">{STOCK.items.length} SKUs</span>
      </div>
    </div>
  );
}
