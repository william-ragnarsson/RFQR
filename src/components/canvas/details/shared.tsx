import type { ReactNode } from "react";
import { ModelLogo } from "@/components/icons";
import { MODELS } from "@/lib/models";
import type { Source } from "@/lib/types";

/** "Email · GPT" / "PDF · Claude": where a value was read, and by which model. */
export function SourceChip({ source }: { source: Source }) {
  const model = source === "email" ? MODELS.text : MODELS.pdf;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-1.5 py-px text-[11px] font-medium whitespace-nowrap text-gray-600"
      title={`Read from the ${source === "email" ? "email text" : "PDF"} by ${model.name}`}
    >
      <ModelLogo provider={model.provider} size={11} />
      {source === "email" ? "Email" : "PDF"} · {model.short}
    </span>
  );
}

/** The buyer's exact words a value was read from. */
export function Quote({ text }: { text: string }) {
  return <p className="mt-0.5 text-xs leading-snug text-gray-500 italic">“{text}”</p>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-2 text-[11px] font-semibold tracking-wider text-gray-400 uppercase">
      {children}
    </h3>
  );
}

/** Small explanatory footer line. */
export function Note({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs leading-relaxed text-gray-500">
      <span className="mt-px shrink-0 text-gray-400">{icon}</span>
      <span>{children}</span>
    </p>
  );
}

export function formatValue(value: string | number | null): string {
  return value === null ? "" : String(value);
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );
}

export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { timeStyle: "short" }).format(new Date(iso));
}

export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}
