// Server only: builds and sends the reply to an RFQ.
//
// sendReply() is ONLY ever called after Thomas approves the draft, and it refuses
// to send unless the reply goes back to the one person who sent the RFQ.
// Subjects and display names come from the outside sender, so every header value
// is reduced to one line (no CR/LF: no header injection) and non-ASCII text is
// RFC 2047 encoded. buildReplyMime() is pure, so it can be tested offline.

import { SELLER } from "../rules";
import type { ReplyDraft, RfqMessage } from "../types";
import { getAccountEmail, getGmail, gmailCall, rfqAddress } from "./client";
import { decodeMimeWords, parseAddresses } from "./inbox";

/** "Thomas Berg, Northline Steel": the seller who signs (and approves) every reply. */
export const DEFAULT_FROM_NAME = `${SELLER.name}, ${SELLER.company}`;

const ASCII = /^[\x20-\x7e]*$/;

/** One line of header text: CR, LF and other control characters become spaces. */
export function headerText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

/** RFC 2047 B-encoding, folded so that header lines stay within 78 characters. */
export function encodeWords(text: string): string {
  const chunks: string[] = [];
  let chunk = "";
  for (const ch of text) {
    // 39 UTF-8 bytes -> 52 base64 characters + 12 for "=?UTF-8?B?" and "?=": 64,
    // which leaves room for "Subject: " on the first line.
    if (Buffer.byteLength(chunk + ch) > 39) {
      chunks.push(chunk);
      chunk = "";
    }
    chunk += ch;
  }
  if (chunk) chunks.push(chunk);
  return chunks.map((c) => `=?UTF-8?B?${Buffer.from(c, "utf8").toString("base64")}?=`).join("\r\n ");
}

function encodeText(text: string): string {
  return ASCII.test(text) ? text : encodeWords(text);
}

/**
 * Re-formats one mailbox (`Name <a@b.com>` or `a@b.com`) safely: a line break is
 * rejected, the name is quoted (or encoded when non-ASCII), and the value must
 * hold exactly one plain address.
 */
export function formatMailbox(value: string): string {
  if (/[\r\n]/.test(value)) throw new Error("Address contains a line break");
  const addresses = parseAddresses(value);
  if (addresses.length !== 1) throw new Error(`Expected exactly one address, got ${addresses.length}`);
  const address = addresses[0];
  if (!/^[^\s@<>()"\\,;:[\]]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(address)) throw new Error("Not a plain email address");

  let name = value.match(/^\s*(.*?)\s*<[^<>]*>\s*$/)?.[1] ?? "";
  if (/^".*"$/.test(name)) name = name.slice(1, -1).replace(/\\(.)/g, "$1");
  name = headerText(decodeMimeWords(name));
  if (!name || name.toLowerCase() === address) return address;
  const display = ASCII.test(name) ? `"${name.replace(/[\\"]/g, "\\$&")}"` : encodeWords(name);
  return `${display} <${address}>`;
}

/**
 * An address the way Gmail delivers it: case-insensitive, and for gmail.com
 * (and googlemail.com) dots in the local part don't count.
 */
export function canonicalAddress(address: string): string {
  const lower = address.trim().toLowerCase();
  const at = lower.lastIndexOf("@");
  const domain = lower.slice(at + 1);
  if (at < 0 || (domain !== "gmail.com" && domain !== "googlemail.com")) return lower;
  return `${lower.slice(0, at).replace(/\./g, "")}@gmail.com`;
}

function messageIds(value: string | null): string[] {
  return value?.match(/<[^<>\s]+>/g) ?? [];
}

/** The reply as an RFC 5322 message (CRLF line endings, UTF-8 body in base64). */
export function buildReplyMime(input: {
  from: string;
  to: string;
  subject: string;
  body: string;
  inReplyTo: string | null;
  references: string | null;
}): string {
  const subject = headerText(input.subject);
  const replySubject = /^re:/i.test(subject) ? subject : `Re: ${subject}`;

  const inReplyTo = messageIds(input.inReplyTo)[0] ?? null;
  let references = messageIds(input.references);
  if (inReplyTo && references[references.length - 1] !== inReplyTo) references.push(inReplyTo);
  if (references.length > 20) references = [references[0], ...references.slice(-19)];

  const body = Buffer.from(input.body.replace(/\r\n?/g, "\n").replace(/\n/g, "\r\n"), "utf8").toString("base64");

  return [
    `From: ${formatMailbox(input.from)}`,
    `To: ${formatMailbox(input.to)}`,
    `Subject: ${encodeText(replySubject)}`,
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`] : []),
    ...(references.length ? [`References: ${references.join("\r\n ")}`] : []),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    ...(body.match(/.{1,76}/g) ?? []),
    "",
  ].join("\r\n");
}

/**
 * Sends the approved reply in the RFQ's thread. Only call this after a human
 * approved `draft`. Refuses unless the reply goes to the RFQ's sender alone.
 */
export async function sendReply(
  rfq: RfqMessage,
  draft: ReplyDraft,
  opts?: { fromName?: string },
): Promise<{ id: string; threadId: string }> {
  const sender = parseAddresses(rfq.email.from);
  const recipients = parseAddresses(draft.to);
  if (sender.length !== 1 || recipients.length !== 1 || recipients[0] !== sender[0]) {
    throw new Error("Refusing to send: a reply may only go to the sender of the RFQ, and only to them");
  }
  if (canonicalAddress(recipients[0]) === canonicalAddress(rfqAddress())) {
    throw new Error("Refusing to send: the reply would go to the RFQ inbox itself");
  }

  const account = await getAccountEmail();
  const fromName = headerText(opts?.fromName ?? DEFAULT_FROM_NAME).replace(/[\\"]/g, "\\$&");
  const mime = buildReplyMime({
    from: `"${fromName}" <${account}>`,
    to: draft.to,
    subject: draft.subject,
    body: draft.body,
    inReplyTo: rfq.messageIdHeader,
    references: rfq.references,
  });

  const res = await gmailCall(() =>
    getGmail().users.messages.send({
      userId: "me",
      requestBody: { raw: Buffer.from(mime, "utf8").toString("base64url"), threadId: rfq.email.threadId || undefined },
    }),
  );
  if (!res.data.id) throw new Error("Gmail did not return an id for the sent reply");
  return { id: res.data.id, threadId: res.data.threadId ?? rfq.email.threadId };
}
