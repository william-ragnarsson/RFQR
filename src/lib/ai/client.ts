// Server only (reads the gateway API key from env; never import from client
// components). One OpenAI-compatible client for the Nicrron LLM gateway, which
// serves both GPT and Claude, plus which model reads which input.

import OpenAI from "openai";
import { MODELS } from "../models";

const DEFAULT_BASE_URL = "https://api.nicrron.ai/v1";

export interface Ai {
  client: OpenAI;
  /** Gateway model ids, "<provider>/<model>". */
  models: { text: string; pdf: string };
}

let cached: Ai | null = null;

/** The shared gateway client. Throws if NICRRON_API_KEY is not set. */
export function getAi(): Ai {
  if (cached) return cached;

  const apiKey = process.env.NICRRON_API_KEY?.trim();
  if (!apiKey) throw new Error("NICRRON_API_KEY is not set. Add it to .env.local.");

  cached = {
    client: new OpenAI({
      apiKey,
      baseURL: process.env.NICRRON_BASE_URL?.trim() || DEFAULT_BASE_URL,
      // Only the gateway key: never pick up OPENAI_* keys or ids from env and
      // forward them to a third-party gateway.
      adminAPIKey: null,
      organization: null,
      project: null,
      timeout: 60_000,
      maxRetries: 2,
    }),
    models: {
      text: process.env.TEXT_MODEL?.trim() || MODELS.text.id,
      pdf: process.env.PDF_MODEL?.trim() || MODELS.pdf.id,
    },
  };
  return cached;
}

/**
 * A short, secret-free description of a failed gateway call (the SDK puts the
 * HTTP status first), with the API key, bearer tokens and anything else that
 * looks like a long token removed (a gateway may echo part of a bad key).
 */
export function safeErrorMessage(err: unknown): string {
  let message = err instanceof Error ? err.message : String(err);
  const key = process.env.NICRRON_API_KEY?.trim();
  if (key) message = message.split(key).join("[redacted]");
  message = message
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/[\w-]{24,}/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim();
  if (!message) return "unknown error";
  return message.length > 200 ? `${message.slice(0, 200)}…` : message;
}
