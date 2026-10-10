import { CircleCheck, Code, TriangleAlert } from "lucide-react";
import { ORDER_TEMPLATE } from "@/lib/mock-run";
import type { FieldStatus, FilledField, FilledForm } from "@/lib/types";
import { Note, Quote, SourceChip, formatValue } from "./shared";

const PROBLEM_LABEL: Record<Exclude<FieldStatus, "ok">, string> = {
  missing: "Missing",
  invalid: "Invalid",
  conflict: "Conflict",
};

export function TemplateDetail({ form }: { form: FilledForm }) {
  const required = form.fields.filter((f) => f.required).length;
  const ok = required - form.missing.length;

  return (
    <div className="space-y-4">
      {form.complete ? (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2.5 text-sm font-medium text-green-800">
          <CircleCheck size={18} className="shrink-0 text-green-600" />
          {ok}/{required} required fields
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm font-medium text-amber-900">
          <TriangleAlert size={18} className="shrink-0 text-amber-600" />
          {ok}/{required} · {form.missing.length} missing → we&apos;ll ask the buyer
        </div>
      )}

      <p className="text-xs leading-relaxed text-gray-500">{ORDER_TEMPLATE.description}</p>

      <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
        {form.fields.map((field) => (
          <FieldRow key={field.key} field={field} />
        ))}
      </ul>

      <Note icon={<Code size={14} />}>
        Filled by plain code: email first, PDF as fallback, then validated against the template.
        No AI decides what goes in the form.
      </Note>
    </div>
  );
}

function FieldRow({ field }: { field: FilledField }) {
  const problem = field.status === "ok" ? null : PROBLEM_LABEL[field.status];
  // Only required fields block the order; an optional problem is just flagged.
  const blocking = field.required && problem !== null;

  return (
    <li className={`px-3 py-2.5 ${blocking ? "bg-red-50" : "bg-white"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-gray-500">
            {field.label}
            {!field.required && <span className="ml-1.5 text-gray-400">· optional</span>}
          </p>
          {field.value !== null ? (
            <p className="text-sm break-words text-gray-900">
              {formatValue(field.value)}
              {problem && (
                <span
                  className={`ml-2 text-xs font-medium ${blocking ? "text-red-600" : "text-amber-700"}`}
                >
                  {problem}
                </span>
              )}
            </p>
          ) : blocking ? (
            <p className="text-sm font-medium text-red-600">{problem}</p>
          ) : (
            <p className="text-sm text-gray-400">not stated</p>
          )}
        </div>
        {field.source && <SourceChip source={field.source} />}
      </div>
      {field.quote && <Quote text={field.quote} />}
      {/* An optional field that simply isn't stated needs no explanation. */}
      {field.note && (blocking || field.status !== "missing") && (
        <p className={`mt-1 text-xs ${blocking ? "text-red-700" : "text-amber-700"}`}>{field.note}</p>
      )}
    </li>
  );
}
