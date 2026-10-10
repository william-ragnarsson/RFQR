// Server-sent events: the live watcher's status and every RunState update.
import { connection } from "next/server";
import { subscribe, type LiveEvent } from "@/lib/live";

export async function GET(request: Request) {
  await connection();
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (e: LiveEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      const unsubscribe = subscribe(send);
      // A comment line now and then keeps proxies and the browser from closing the stream.
      const ping = setInterval(() => controller.enqueue(encoder.encode(": ping\n\n")), 15_000);
      cleanup = () => {
        clearInterval(ping);
        unsubscribe();
      };
      request.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
