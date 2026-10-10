import { Milestone } from "lucide-react";
import { NODE_META } from "../node-meta";
import type { RoadmapId } from "../run-context";
import { Note } from "./shared";

/** Drawer body for an input or file type that is on the roadmap. */
export function RoadmapDetail({ id }: { id: RoadmapId }) {
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-gray-700">{NODE_META[id].roadmap}</p>
      <Note icon={<Milestone size={14} />}>
        On the roadmap, not connected in this demo. The live path runs on Gmail, the email text and
        the PDF.
      </Note>
    </div>
  );
}
