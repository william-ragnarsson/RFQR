import { Inbox, LoaderCircle, X } from "lucide-react";
import type { ReactNode } from "react";
import { MODELS } from "@/lib/models";
import type { RunState } from "@/lib/types";
import { EmailDetail } from "./details/EmailDetail";
import { ExtractionDetail } from "./details/ExtractionDetail";
import { InventoryDetail, InventorySkipped } from "./details/InventoryDetail";
import { ReplyDetail } from "./details/ReplyDetail";
import { StockDetail } from "./details/StockDetail";
import { TemplateDetail } from "./details/TemplateDetail";
import { NODE_META, NodeIcon, isNodeId } from "./node-meta";
import { nodeState, type Selection } from "./run-context";
import { ModelPill, StatusPill } from "./status";

interface DetailPanelProps {
  selected: Selection;
  run: RunState | null;
  onClose: () => void;
  onApprove: () => void;
}

export function DetailPanel({ selected, run, onClose, onApprove }: DetailPanelProps) {
  const meta = NODE_META[selected];
  const model = meta.model ? MODELS[meta.model] : null;
  const state = isNodeId(selected) ? nodeState(run, selected) : null;

  return (
    <aside
      aria-label={`${meta.label} details`}
      className="animate-drawer-in absolute top-0 right-0 bottom-0 z-10 flex w-[420px] max-w-full shrink-0 flex-col border-l border-gray-200 bg-white shadow-xl md:static md:shadow-none"
    >
      <header className="flex shrink-0 items-start gap-3 border-b border-gray-200 px-5 py-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white">
          <NodeIcon id={selected} size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-gray-900">{meta.label}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {state && <StatusPill status={state.status} />}
            {model && <ModelPill model={model} size="md" />}
            {!state && <span className="text-xs text-gray-500">{meta.subtitle}</span>}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="-mt-1 -mr-2 rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:outline-none"
        >
          <X size={18} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <PanelBody selected={selected} run={run} onApprove={onApprove} />
      </div>
    </aside>
  );
}

function PanelBody({
  selected,
  run,
  onApprove,
}: Pick<DetailPanelProps, "selected" | "run" | "onApprove">): ReactNode {
  if (selected === "db") {
    return <StockDetail matchedSku={run?.inventory?.match?.sku ?? null} />;
  }

  const { status } = nodeState(run, selected);

  switch (selected) {
    case "gmail":
      if (run?.email) return <EmailDetail email={run.email} />;
      break;
    case "text":
      if (run?.text) return <ExtractionDetail result={run.text} />;
      break;
    case "pdf":
      if (run?.pdf)
        return (
          <ExtractionDetail
            result={run.pdf}
            filename={run.email?.attachment?.filename}
            pages={run.email?.attachment?.pages}
          />
        );
      break;
    case "template":
      if (run?.form) return <TemplateDetail form={run.form} />;
      break;
    case "inventory":
      if (run?.inventory) return <InventoryDetail inventory={run.inventory} />;
      if (status === "skipped") return <InventorySkipped missing={run?.form?.missing ?? []} />;
      break;
    case "reply":
      if (run?.reply) return <ReplyDetail reply={run.reply} onApprove={onApprove} />;
      break;
  }

  if (status === "running") {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center text-sm text-gray-500">
        <LoaderCircle size={22} className="animate-spin text-indigo-500" />
        Working…
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center text-sm text-gray-500">
      <Inbox size={22} className="text-gray-300" />
      {run ? "Waiting for the previous step." : "No data yet — waiting for an RFQ email."}
    </div>
  );
}
