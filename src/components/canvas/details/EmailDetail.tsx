import { Paperclip } from "lucide-react";
import type { IncomingEmail } from "@/lib/types";
import { SectionTitle, formatDateTime } from "./shared";

export function EmailDetail({ email }: { email: IncomingEmail }) {
  const meta: [string, string][] = [
    ["From", email.from],
    ["To", email.to],
    ["Subject", email.subject],
    ["Received", formatDateTime(email.receivedAt)],
  ];

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-[72px_1fr] gap-x-3 gap-y-1.5 text-sm">
        {meta.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-gray-500">{label}</dt>
            <dd className="min-w-0 break-words text-gray-900">{value}</dd>
          </div>
        ))}
      </dl>

      <section>
        <SectionTitle>Body</SectionTitle>
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm leading-relaxed whitespace-pre-wrap text-gray-800">
          {email.body}
        </div>
      </section>

      {email.attachment && (
        <section>
          <SectionTitle>Attachment</SectionTitle>
          <span className="inline-flex max-w-full items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-800">
            <Paperclip size={14} className="shrink-0 text-gray-500" />
            <span className="truncate">{email.attachment.filename}</span>
            <span className="shrink-0 text-xs text-gray-500">
              {email.attachment.pages} {email.attachment.pages === 1 ? "page" : "pages"}
            </span>
          </span>
        </section>
      )}
    </div>
  );
}
