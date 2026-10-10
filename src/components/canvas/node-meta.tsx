import { ClipboardCheck, Database, FileText, Send, TextAlignStart, Warehouse } from "lucide-react";
import { GmailIcon } from "@/components/icons";
import type { ModelSlot } from "@/lib/models";
import type { NodeId } from "@/lib/types";
import type { Selection } from "./run-context";

export interface NodeMeta {
  label: string;
  subtitle: string;
  /** Which AI model reads this input (only the two extractor nodes). */
  model?: ModelSlot;
}

export const NODE_META: Record<Selection, NodeMeta> = {
  gmail: { label: "New RFQ email", subtitle: "Gmail trigger" },
  text: { label: "Email text", subtitle: "Extract order details", model: "text" },
  pdf: { label: "PDF spec sheet", subtitle: "Read attached spec", model: "pdf" },
  template: { label: "Order Intake Form", subtitle: "Fill template" },
  inventory: { label: "Inventory check", subtitle: "Stock & price" },
  reply: { label: "Reply to buyer", subtitle: "Gmail · needs approval" },
  db: { label: "Stock DB", subtitle: "inventory.json" },
};

export const isNodeId = (s: Selection): s is NodeId => s !== "db";

/** The icon drawn inside a node square (and, smaller, in the drawer header). */
export function NodeIcon({ id, size = 40 }: { id: Selection; size?: number }) {
  const lucide = { size, strokeWidth: 1.5, className: "text-gray-700" };
  switch (id) {
    case "gmail":
      return <GmailIcon size={size} />;
    case "reply":
      return (
        <span className="relative inline-flex">
          <GmailIcon size={size} />
          <span
            className="absolute -right-2.5 -bottom-2 flex items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700"
            style={{ width: size * 0.5, height: size * 0.5 }}
          >
            <Send size={size * 0.28} strokeWidth={2} />
          </span>
        </span>
      );
    case "text":
      return <TextAlignStart {...lucide} />;
    case "pdf":
      return <FileText {...lucide} />;
    case "template":
      return <ClipboardCheck {...lucide} />;
    case "inventory":
      return <Warehouse {...lucide} />;
    case "db":
      return <Database {...lucide} />;
  }
}
