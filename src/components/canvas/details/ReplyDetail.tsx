import { CircleCheck, Send, ShieldCheck } from "lucide-react";
import { OUTCOME_LABELS } from "@/lib/rules";
import type { Outcome, ReplyDraft } from "@/lib/types";
import { Note, SectionTitle, formatTime } from "./shared";

const OUTCOME_STYLE: Record<Outcome, string> = {
  confirmed: "border-green-200 bg-green-50 text-green-800",
  clarify: "border-amber-200 bg-amber-50 text-amber-900",
  unavailable: "border-red-200 bg-red-50 text-red-800",
};

interface ReplyDetailProps {
  reply: ReplyDraft & { sentAt?: string };
  onApprove: () => void;
}

export function ReplyDetail({ reply, onApprove }: ReplyDetailProps) {
  const sent = Boolean(reply.sentAt);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {sent ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-green-700">
            <CircleCheck size={16} />
            Sent {reply.sentAt && formatTime(reply.sentAt)}
          </span>
        ) : (
          <span className="text-sm font-medium text-gray-900">Draft — needs your approval</span>
        )}
        <span
          className={`rounded-full border px-2 py-0.5 text-xs font-medium ${OUTCOME_STYLE[reply.outcome]}`}
        >
          {OUTCOME_LABELS[reply.outcome]}
        </span>
      </div>

      <dl className="grid grid-cols-[64px_1fr] gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-gray-500">To</dt>
        <dd className="min-w-0 break-words text-gray-900">{reply.to}</dd>
        <dt className="text-gray-500">Subject</dt>
        <dd className="min-w-0 break-words text-gray-900">{reply.subject}</dd>
      </dl>

      <section>
        <SectionTitle>Message</SectionTitle>
        <div className="rounded-lg border border-gray-200 bg-white p-3 font-sans text-sm leading-relaxed whitespace-pre-wrap text-gray-800 shadow-xs">
          {reply.body}
        </div>
      </section>

      <div className="space-y-2">
        <button
          type="button"
          onClick={onApprove}
          disabled={sent}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-gray-900 text-sm font-medium text-white hover:bg-gray-800 focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:outline-none disabled:cursor-default disabled:bg-gray-200 disabled:text-gray-500"
        >
          {sent ? <CircleCheck size={16} /> : <Send size={16} />}
          {sent ? "Sent" : "Approve & send"}
        </button>
        <Note icon={<ShieldCheck size={14} />}>
          Nothing is sent until you approve. The draft is written by plain code from the checked
          form and the stock result. (Demo run: approving only marks it as sent.)
        </Note>
      </div>
    </div>
  );
}
