// Server only: finds RFQ emails in the demo inbox and reads them.
//
// The inbox is the user's PERSONAL one, so the rule is strict: a message is only
// looked at if its To, Cc or Delivered-To header holds the exact RFQ address
// (a plain-address mail to you@gmail.com never matches you+rfq@gmail.com), it
// arrived after `since`, and it is not a draft. listNewRfqIds() asks Gmail for
// candidates and re-checks the headers itself; fetchRfq() checks them again
// before it reads anything else. Nothing here changes the mailbox.
//
// Email bodies and PDFs come from outside senders: they are returned as data
// only. The pure MIME helpers are exported so they can be tested offline.

import type { gmail_v1 } from "googleapis/build/src/apis/gmail";
import type { IncomingEmail, RfqMessage } from "../types";
import { getGmail, gmailCall } from "./client";

type Header = gmail_v1.Schema$MessagePartHeader;
type Part = gmail_v1.Schema$MessagePart;

/** Longest body handed to the pipeline; RFQ emails are short. */
export const MAX_BODY_CHARS = 20_000;
/** Each text part is cut to this before it is converted (HTML mail is bulkier than its text). */
const MAX_PART_CHARS = 200_000;
/** Bigger PDFs are ignored (the pipeline then treats the RFQ as having no spec sheet). */
export const MAX_PDF_BYTES = 15 * 1024 * 1024;

const RECIPIENT_HEADERS = ["To", "Cc", "Delivered-To"];

// ---------------------------------------------------------------------------
// Headers and addresses

/** First header with this name (case-insensitive), RFC 2047 decoded, on one line. */
export function headerValue(headers: Header[] | null | undefined, name: string): string | null {
  return headerValues(headers, name)[0] ?? null;
}

/** All headers with this name (Delivered-To can appear more than once), RFC 2047 decoded. */
export function headerValues(headers: Header[] | null | undefined, name: string): string[] {
  return rawHeaderValues(headers, name).map((v) => decodeMimeWords(v).replace(/\s+/g, " ").trim());
}

function rawHeaderValues(headers: Header[] | null | undefined, name: string): string[] {
  const lower = name.toLowerCase();
  return (headers ?? [])
    .filter((h) => h.name?.toLowerCase() === lower && typeof h.value === "string")
    .map((h) => h.value!);
}

/**
 * The bare addresses in an address-list header, lowercase:
 * `"Berg, Thomas" <T@x.com>, b@y.com` -> ["t@x.com", "b@y.com"].
 * Display names and (comments) are ignored, so a display name that looks like
 * an address never counts as one.
 */
export function parseAddresses(value: string): string[] {
  // Blank out quoted strings and comments: commas, colons and @ inside them are not syntax.
  let plain = "";
  let quoted = false;
  let depth = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (quoted || depth > 0) {
      if (c === "\\") i++;
      else if (quoted && c === '"') quoted = false;
      else if (!quoted && c === "(") depth++;
      else if (!quoted && c === ")") depth--;
      plain += " ";
    } else if (c === '"') {
      quoted = true;
      plain += " ";
    } else if (c === "(") {
      depth = 1;
      plain += " ";
    } else {
      plain += c;
    }
  }

  const out: string[] = [];
  for (let entry of plain.split(/[,;]/)) {
    const angle = entry.match(/<([^<>]*)>[^<>]*$/); // the real address is the last <...>
    if (angle) entry = angle[1];
    else entry = entry.slice(entry.lastIndexOf(":") + 1); // group syntax "Team: a@x.com"
    const address = entry.trim().toLowerCase();
    if (/^[^\s@<>]+@[^\s@<>]+$/.test(address)) out.push(address);
  }
  return out;
}

/**
 * The sender for display and for the reply. The RFC 2047 decoded From is used
 * only when it still names the same single address as the raw header: an
 * encoded display name must not be able to change who the reply goes to.
 * Otherwise the bare raw address, or "" when there isn't exactly one.
 */
export function senderHeader(headers: Header[] | null | undefined): string {
  const raw = parseAddresses(rawHeaderValues(headers, "From")[0] ?? "");
  if (raw.length !== 1) return "";
  const decoded = headerValue(headers, "From") ?? "";
  const same = parseAddresses(decoded);
  return same.length === 1 && same[0] === raw[0] ? decoded : raw[0];
}

/** True when To, Cc or Delivered-To holds exactly this address (case-insensitive). */
export function isAddressedTo(headers: Header[] | null | undefined, address: string): boolean {
  const target = address.trim().toLowerCase();
  // Raw (not RFC 2047 decoded) values: an encoded display name must not be able to smuggle in an address.
  return RECIPIENT_HEADERS.some((name) =>
    rawHeaderValues(headers, name).some((value) => parseAddresses(value).includes(target)),
  );
}

/** Decodes RFC 2047 encoded words (`=?UTF-8?B?...?=`); other text is returned as is. */
export function decodeMimeWords(value: string): string {
  return value
    .replace(/(=\?[^?\s]+\?[bq]\?[^?\s]*\?=)\s+(?==\?)/gi, "$1") // whitespace between encoded words is dropped
    .replace(/=\?([^?\s]+)\?([bq])\?([^?\s]*)\?=/gi, (word, charset: string, enc: string, text: string) => {
      try {
        const qText = () =>
          text.replace(/_/g, " ").replace(/=([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
        const bytes = enc.toLowerCase() === "b" ? Buffer.from(text, "base64") : Buffer.from(qText(), "latin1");
        return decodeBytes(bytes, charset.split("*")[0]);
      } catch {
        return word;
      }
    });
}

// ---------------------------------------------------------------------------
// MIME body and attachments

/** Decodes Gmail's base64url part data. */
export function decodeBase64Url(data: string): Uint8Array {
  return new Uint8Array(Buffer.from(data, "base64url"));
}

function decodeBytes(bytes: Uint8Array, charset: string | null | undefined): string {
  try {
    return new TextDecoder(charset || "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes); // unknown charset label
  }
}

function charsetOf(part: Part): string | null {
  const type = headerValue(part.headers, "Content-Type") ?? "";
  return type.match(/charset\s*=\s*"?([^";\s]+)"?/i)?.[1] ?? null;
}

function isAttachment(part: Part): boolean {
  const disposition = headerValue(part.headers, "Content-Disposition") ?? "";
  return Boolean(part.filename) || /^\s*attachment/i.test(disposition);
}

/** Every part of the MIME tree, depth first, in document order. */
export function flattenParts(part: Part | null | undefined): Part[] {
  if (!part) return [];
  return [part, ...(part.parts ?? []).flatMap(flattenParts)];
}

/**
 * The readable body of a message: its inline text/plain parts, or else its
 * text/html parts converted to plain text. LF line endings, trimmed, capped.
 */
export function extractBody(payload: Part | null | undefined): string {
  const inline = flattenParts(payload).filter((p) => !isAttachment(p) && p.body?.data);
  const decode = (p: Part) => decodeBytes(decodeBase64Url(p.body!.data!), charsetOf(p)).slice(0, MAX_PART_CHARS);

  const plain = inline.filter((p) => p.mimeType?.toLowerCase() === "text/plain");
  const html = inline.filter((p) => p.mimeType?.toLowerCase() === "text/html");
  const text = plain.length
    ? plain.map(decode).join("\n\n")
    : html.map((p) => htmlToText(decode(p))).join("\n\n");

  const body = text.replace(/\r\n?/g, "\n").trim();
  return body.length > MAX_BODY_CHARS ? `${body.slice(0, MAX_BODY_CHARS)}\n[... truncated]` : body;
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "–", mdash: "—", hellip: "…", middot: "·", times: "×", deg: "°",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", bull: "•", copy: "©", reg: "®", euro: "€",
};

/**
 * Rough HTML to text for email bodies: drops markup, keeps line breaks, decodes
 * entities. Every pattern runs in linear time (tags stop at the next "<", an
 * unclosed comment or script runs to the end), so hostile HTML can't stall it.
 */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<(script|style|head|title)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, "")
    .replace(/\s+/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^<>]*>/gi, "\n- ")
    .replace(/<\/?(p|div|table|ul|ol|h[1-6]|blockquote|section|article|header|footer|pre)\b[^<>]*>/gi, "\n")
    .replace(/<\/tr\s*>/gi, "\n") // one table row per line
    .replace(/<\/t[dh]\s*>/gi, " ")
    .replace(/<[^<>]*>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+\d*);/gi, (entity, name: string) => {
      if (name[0] === "#") {
        const code = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
      }
      return ENTITIES[name.toLowerCase()] ?? entity;
    });
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The first PDF attachment: by mime type, or an octet-stream named *.pdf. */
export function findPdfPart(payload: Part | null | undefined): Part | null {
  return (
    flattenParts(payload).find((p) => {
      const type = p.mimeType?.toLowerCase() ?? "";
      const named = (p.filename ?? "").toLowerCase().endsWith(".pdf");
      const isPdf = type === "application/pdf" || (type === "application/octet-stream" && named);
      return isPdf && Boolean(p.body?.data || p.body?.attachmentId);
    }) ?? null
  );
}

/**
 * Attachment names come from the sender: keep them short and free of paths,
 * control characters and invisible bidi/zero-width marks (which can disguise
 * a name, e.g. "spec\u202Efdp.exe").
 */
export function safeFilename(name: string | null | undefined): string {
  const clean = (name ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff/\\]+/g, "_")
    .trim()
    .slice(-120);
  return clean || "attachment.pdf";
}

// ---------------------------------------------------------------------------
// Gmail API

function isDraft(labelIds: string[] | null | undefined): boolean {
  return (labelIds ?? []).includes("DRAFT");
}

/**
 * Ids of RFQ messages that arrived at or after `since`, oldest first.
 * `skipIds` (e.g. already processed) are neither fetched nor returned.
 * Reads only the recipient headers of the candidates, nothing else.
 * Candidates that turn out not to qualify are passed to `onRejected`, so a
 * caller can skip them next time too. Spam and Trash are never searched.
 */
export async function listNewRfqIds(opts: {
  rfqAddress: string;
  since: Date;
  skipIds?: ReadonlySet<string>;
  onRejected?: (id: string) => void;
}): Promise<{ id: string; internalDate: number }[]> {
  const gmail = getGmail();
  const address = opts.rfqAddress.trim().toLowerCase();
  const sinceMs = opts.since.getTime();
  // Gmail's after: works in seconds and is coarse; the exact cut is made on internalDate below.
  const afterSec = Math.floor(sinceMs / 1000) - 120;
  const q = `{to:${address} deliveredto:${address} cc:${address}} -in:drafts after:${afterSec}`;

  const ids: string[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 5; page++) {
    const res = await gmailCall(() =>
      gmail.users.messages.list({ userId: "me", q, includeSpamTrash: false, maxResults: 100, pageToken }),
    );
    for (const m of res.data.messages ?? []) if (m.id && !opts.skipIds?.has(m.id)) ids.push(m.id);
    pageToken = res.data.nextPageToken ?? undefined;
    if (!pageToken) break;
  }

  const found: { id: string; internalDate: number }[] = [];
  for (const id of ids) {
    const res = await gmailCall(() =>
      gmail.users.messages.get({
        userId: "me",
        id,
        format: "metadata",
        metadataHeaders: RECIPIENT_HEADERS,
        // Partial response: no snippet, no subject, no sender.
        fields: "id,labelIds,internalDate,payload/headers",
      }),
    );
    const internalDate = Number(res.data.internalDate);
    const qualifies =
      Number.isFinite(internalDate) &&
      internalDate >= sinceMs &&
      !isDraft(res.data.labelIds) &&
      isAddressedTo(res.data.payload?.headers, address);
    if (qualifies) found.push({ id, internalDate });
    else opts.onRejected?.(id);
  }
  return found.sort((a, b) => a.internalDate - b.internalDate || a.id.localeCompare(b.id));
}

/**
 * Reads one RFQ message: headers, plain-text body and the first PDF attachment.
 * Throws (without reading the content) if it is not addressed to the RFQ address.
 */
export async function fetchRfq(
  id: string,
  rfqAddress: string,
  opts?: { log?: (msg: string) => void },
): Promise<RfqMessage> {
  const gmail = getGmail();
  const res = await gmailCall(() => gmail.users.messages.get({ userId: "me", id, format: "full" }));
  const msg = res.data;
  const headers = msg.payload?.headers;

  // Defense in depth: listNewRfqIds already checked this.
  if (!isAddressedTo(headers, rfqAddress) || isDraft(msg.labelIds)) {
    throw new Error(`Message ${id} is not an RFQ (not addressed to ${rfqAddress.toLowerCase()}): refusing to read it`);
  }

  let pdf: RfqMessage["pdf"] = null;
  const part = findPdfPart(msg.payload);
  if (part) {
    const filename = safeFilename(part.filename);
    if ((part.body?.size ?? 0) > MAX_PDF_BYTES) {
      opts?.log?.(`PDF ${filename} is larger than ${MAX_PDF_BYTES / 1024 / 1024} MB: ignored`);
    } else {
      let data = part.body?.data ? decodeBase64Url(part.body.data) : null;
      if (!data && part.body?.attachmentId) {
        const attachmentId = part.body.attachmentId;
        const att = await gmailCall(() =>
          gmail.users.messages.attachments.get({ userId: "me", messageId: id, id: attachmentId }),
        );
        data = att.data.data ? decodeBase64Url(att.data.data) : null;
      }
      if (!data || data.length > MAX_PDF_BYTES) {
        opts?.log?.(`PDF ${filename} could not be downloaded or is too large: ignored`);
      } else if (!Buffer.from(data.subarray(0, 1024)).toString("latin1").includes("%PDF-")) {
        opts?.log?.(`${filename} is not a PDF file: ignored`);
      } else {
        pdf = { filename, data };
      }
    }
  }

  const email: IncomingEmail = {
    id: msg.id ?? id,
    threadId: msg.threadId ?? "",
    from: senderHeader(headers),
    to: headerValue(headers, "To") ?? rfqAddress,
    subject: headerValue(headers, "Subject") ?? "",
    body: extractBody(msg.payload),
    receivedAt: (msg.internalDate ? new Date(Number(msg.internalDate)) : new Date()).toISOString(),
    attachment: pdf ? { filename: pdf.filename, pages: 0 } : null, // pages: filled in after rendering
  };

  return {
    email,
    messageIdHeader: headerValue(headers, "Message-ID"),
    references: headerValue(headers, "References"),
    pdf,
  };
}
