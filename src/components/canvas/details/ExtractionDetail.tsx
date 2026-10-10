import { FileText, ShieldCheck } from "lucide-react";
import { ORDER_TEMPLATE, countFound } from "@/lib/mock-run";
import { modelInfo } from "@/lib/models";
import type { ExtractorResult } from "@/lib/types";
import { Note, Quote, SectionTitle, formatSeconds, formatValue } from "./shared";

interface ExtractionDetailProps {
  result: ExtractorResult & { pageImages?: string[] };
  /** PDF filename, for the page preview placeholder. */
  filename?: string;
  pages?: number;
}

export function ExtractionDetail({ result, filename, pages = 1 }: ExtractionDetailProps) {
  const model = modelInfo(result.model);
  const isPdf = result.source === "pdf";
  const page = result.pageImages?.[0];

  return (
    <div className="space-y-5">
      <p className="text-xs text-gray-500">
        <span className="font-medium text-gray-700">{model.name}</span> read the{" "}
        {isPdf ? "PDF" : "email text"} in {formatSeconds(result.ms)} ·{" "}
        {countFound(result)} of {ORDER_TEMPLATE.fields.length} fields found
      </p>

      {isPdf && (
        <section>
          <SectionTitle>Page 1</SectionTitle>
          {page ? (
            // Rendered page images are data URLs; next/image adds nothing here.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={page}
              alt={`Page 1 of ${filename ?? "the spec sheet"}`}
              className="w-full rounded-lg border border-gray-200 bg-white shadow-xs"
            />
          ) : (
            <div className="flex h-36 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 text-gray-500">
              <FileText size={28} strokeWidth={1.5} />
              <span className="max-w-[90%] truncate text-sm text-gray-700">
                {filename ?? "spec sheet.pdf"}
              </span>
              <span className="text-xs">
                {pages} {pages === 1 ? "page" : "pages"}
              </span>
            </div>
          )}
        </section>
      )}

      <section>
        <SectionTitle>What the model found</SectionTitle>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-gray-100">
            {ORDER_TEMPLATE.fields.map((field) => {
              const found = result.fields.find((e) => e.key === field.key);
              const value = found?.value ?? null;
              return (
                <tr key={field.key} className="align-top">
                  <td className="w-[38%] py-2 pr-3 text-xs text-gray-500">{field.label}</td>
                  <td className="py-2">
                    {value === null ? (
                      <span className="text-gray-400">not stated</span>
                    ) : (
                      <span className="text-gray-900">{formatValue(value)}</span>
                    )}
                    {found?.quote && <Quote text={found.quote} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <Note icon={<ShieldCheck size={14} />}>
        The model only extracts. Every value comes with the exact words it was read from, and
        anything not stated stays empty. Merging and checking happen in plain code.
      </Note>
    </div>
  );
}
