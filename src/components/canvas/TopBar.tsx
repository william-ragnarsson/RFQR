import { ChevronDown, LoaderCircle, Play, Workflow } from "lucide-react";
import { RFQ_INBOX } from "@/lib/mock-run";

interface TopBarProps {
  scenarios: { id: string; title: string }[];
  scenarioId: string;
  onScenarioChange: (id: string) => void;
  onSimulate: () => void;
  busy: boolean;
}

export function TopBar({ scenarios, scenarioId, onScenarioChange, onSimulate, busy }: TopBarProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-gray-200 bg-white px-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-gray-900 text-white">
          <Workflow size={16} strokeWidth={2} />
        </span>
        <span className="text-[15px] font-semibold tracking-tight text-gray-900">RFQR</span>
        <span className="hidden text-gray-300 sm:inline">/</span>
        <span className="hidden truncate text-sm text-gray-600 sm:inline">RFQ → Order reply</span>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <span className="hidden items-center gap-2 rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs text-green-800 lg:inline-flex">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-green-500" />
          </span>
          Watching {RFQ_INBOX}
        </span>

        <label htmlFor="demo-scenario" className="hidden text-xs text-gray-400 sm:block">
          Demo
        </label>
        <div className="relative">
          <select
            id="demo-scenario"
            value={scenarioId}
            onChange={(e) => onScenarioChange(e.target.value)}
            disabled={busy}
            className="h-8 max-w-44 cursor-pointer appearance-none truncate rounded-md sm:max-w-none border border-gray-300 bg-white pr-8 pl-2.5 text-sm text-gray-800 hover:border-gray-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          >
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
          <ChevronDown
            size={14}
            className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-gray-500"
          />
        </div>
        <button
          type="button"
          onClick={onSimulate}
          disabled={busy}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-800 hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? (
            <LoaderCircle size={14} className="animate-spin" />
          ) : (
            <Play size={14} className="fill-current" />
          )}
          {busy ? "Running…" : "Simulate"}
        </button>
      </div>
    </header>
  );
}
