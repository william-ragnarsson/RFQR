import {
  ClipboardCheck,
  CloudUpload,
  Database,
  FileImage,
  FileSpreadsheet,
  FileText,
  Send,
  TextAlignStart,
  Warehouse,
} from "lucide-react";
import { GmailIcon, SlackIcon, TeamsIcon } from "@/components/icons";
import type { ModelSlot } from "@/lib/models";
import { NODE_IDS, type NodeId } from "@/lib/types";
import type { RoadmapId, Selection } from "./run-context";

export interface NodeMeta {
  label: string;
  subtitle: string;
  /** Which AI model reads this input (only the two extractor nodes). */
  model?: ModelSlot;
  /** Roadmap nodes only: what this node would do, shown in the drawer. */
  roadmap?: string;
}

export const NODE_META: Record<Selection, NodeMeta> = {
  gmail: { label: "New RFQ email", subtitle: "Gmail trigger" },
  text: { label: "Email text", subtitle: "Extract order details", model: "text" },
  pdf: { label: "PDF spec sheet", subtitle: "Read attached spec", model: "pdf" },
  template: { label: "Order Intake Form", subtitle: "Fill template" },
  inventory: { label: "Inventory check", subtitle: "Stock & price" },
  reply: { label: "Reply to buyer", subtitle: "Gmail · needs approval" },
  db: { label: "Stock DB", subtitle: "inventory.json" },
  slack: {
    label: "Slack message",
    subtitle: "Slack trigger",
    roadmap:
      "Watch an #rfq channel in Slack. The buyer's message and any attached files go through the same readers, order form and stock check, and the reply is posted back in the thread once Thomas approves it.",
  },
  teams: {
    label: "Teams message",
    subtitle: "Microsoft Teams trigger",
    roadmap:
      "The same for companies on Microsoft 365: watch a Teams channel or chat, read the message and its files, and reply in the same conversation once Thomas approves it.",
  },
  upload: {
    label: "Upload zone",
    subtitle: "Drag & drop files",
    roadmap:
      "Drop files straight onto the canvas: a PDF, a spreadsheet or a photo. For RFQs that arrive by fax, post or a buyer portal. The reply is drafted the same way, ready to copy or send.",
  },
  excel: {
    label: "Excel sheet",
    subtitle: "Read line items",
    roadmap:
      "Read RFQs sent as an .xlsx or .csv file, often one row per line item. Each row is filled into the order form and checked against stock, with the cell every value came from.",
  },
  image: {
    label: "Image",
    subtitle: "Read photo or scan",
    roadmap:
      "Read photos and scans, like a phone picture of a drawing or a scanned PDF without a text layer. Every value still points to where on the page it was read, so Thomas can check it.",
  },
};

/** Roadmap inputs (drawn as triggers) and file types; the order is top to bottom on the canvas. */
export const ROADMAP_INPUTS: RoadmapId[] = ["slack", "teams", "upload"];
export const ROADMAP_READERS: RoadmapId[] = ["excel", "image"];

export const isNodeId = (s: Selection): s is NodeId => (NODE_IDS as Selection[]).includes(s);

export const isRoadmapId = (s: Selection): s is RoadmapId =>
  ROADMAP_INPUTS.includes(s as RoadmapId) || ROADMAP_READERS.includes(s as RoadmapId);

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
    case "slack":
      return <SlackIcon size={size} />;
    case "teams":
      return <TeamsIcon size={size} />;
    case "upload":
      return <CloudUpload {...lucide} />;
    case "excel":
      return <FileSpreadsheet {...lucide} />;
    case "image":
      return <FileImage {...lucide} />;
  }
}
