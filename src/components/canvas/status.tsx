import { Check, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { ModelLogo } from "@/components/icons";
import type { ModelInfo } from "@/lib/models";
import type { NodeStatus } from "@/lib/types";

export const STATUS_LABEL: Record<NodeStatus, string> = {
  idle: "Idle",
  running: "Running",
  done: "Done",
  warning: "Needs attention",
  error: "Error",
  skipped: "Skipped",
  awaiting: "Awaiting approval",
};

const STATUS_PILL: Record<NodeStatus, string> = {
  idle: "bg-gray-100 text-gray-600",
  running: "bg-indigo-50 text-indigo-700",
  done: "bg-green-50 text-green-700",
  warning: "bg-amber-50 text-amber-800",
  error: "bg-red-50 text-red-700",
  skipped: "bg-gray-100 text-gray-500",
  awaiting: "bg-indigo-50 text-indigo-700",
};

/** Text pill used in the drawer header. */
export function StatusPill({ status }: { status: NodeStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_PILL[status]}`}
    >
      {status === "running" && <LoaderCircle size={12} className="animate-spin" />}
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Small round badge on the bottom-right corner of a node square. */
export function StatusBadge({ status }: { status: NodeStatus }) {
  const corner = "absolute -bottom-2 flex items-center justify-center rounded-full";
  const ring = `${corner} -right-2`;
  switch (status) {
    case "running":
      return (
        <span className={`${ring} size-6 border border-indigo-200 bg-white text-indigo-500`}>
          <LoaderCircle size={14} className="animate-spin" />
        </span>
      );
    case "done":
      return (
        <span className={`${ring} size-6 bg-green-500 text-white ring-2 ring-white`}>
          <Check size={14} strokeWidth={3} />
        </span>
      );
    case "warning":
      return (
        <span className={`${ring} size-6 bg-amber-500 text-white ring-2 ring-white`}>
          <TriangleAlert size={13} strokeWidth={2.5} />
        </span>
      );
    case "error":
      return (
        <span className={`${ring} size-6 bg-red-500 text-white ring-2 ring-white`}>
          <X size={14} strokeWidth={3} />
        </span>
      );
    case "awaiting":
      return (
        <span
          className={`${corner} -right-4 h-5 bg-indigo-600 px-2 text-[10px] font-semibold tracking-wide text-white ring-2 ring-white`}
        >
          Approve
        </span>
      );
    default:
      return null;
  }
}

/** "[logo] GPT-5.4 mini" pill. */
export function ModelPill({ model, size = "sm" }: { model: ModelInfo; size?: "sm" | "md" }) {
  const md = size === "md";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white text-gray-700 ${
        md ? "px-2 py-0.5 text-xs" : "px-1.5 py-px text-[10px]"
      }`}
    >
      <ModelLogo provider={model.provider} size={md ? 12 : 10} />
      {model.name}
    </span>
  );
}
