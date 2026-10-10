// "Approve & send" on the canvas: sends the drafted reply of one live run.
import { safeErrorMessage } from "@/lib/ai/client";
import { approve } from "@/lib/live";

export async function POST(request: Request) {
  // Only the canvas itself may approve (no cross-site form posts).
  if (request.headers.get("sec-fetch-site") !== "same-origin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as { runId?: unknown } | null;
  if (typeof body?.runId !== "string") return Response.json({ error: "runId missing" }, { status: 400 });
  try {
    const run = await approve(body.runId);
    return Response.json({ run });
  } catch (err) {
    return Response.json({ error: safeErrorMessage(err) }, { status: 400 });
  }
}
