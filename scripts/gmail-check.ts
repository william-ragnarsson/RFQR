/**
 * Read-only Gmail diagnostics: checks that the OAuth refresh token works and
 * lists the RFQ emails of the last 7 days (date, PDF, subject).
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/gmail-check.ts
 *
 * The inbox is a personal one: only mail addressed to RFQ_ADDRESS is looked at,
 * nothing about any other mail is printed, and nothing in the mailbox changes.
 */
import { getAccountEmail, GmailError, rfqAddress } from "../src/lib/gmail/client";
import { fetchRfq, listNewRfqIds } from "../src/lib/gmail/inbox";
import { clean } from "./lib/print";

const DAYS = 7;
const MAX_LISTED = 20;

async function main() {
  const rfq = rfqAddress();
  const account = await getAccountEmail();
  console.log(`Gmail token ok`);
  console.log(`Account:     ${account}`);
  console.log(`RFQ address: ${rfq}`);

  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);
  const found = await listNewRfqIds({ rfqAddress: rfq, since });
  console.log(`\nRFQ emails in the last ${DAYS} days: ${found.length}`);

  const latest = found.slice(-MAX_LISTED).reverse(); // newest first
  if (found.length > latest.length) console.log(`(showing the latest ${latest.length})`);
  for (const { id } of latest) {
    const notes: string[] = [];
    const { email, pdf } = await fetchRfq(id, rfq, { log: (msg) => notes.push(msg) });
    // Subject, filename and notes come from the sender: clean() keeps escapes and bidi marks out.
    const pdfInfo = pdf ? `PDF ${clean(pdf.filename)} (${Math.ceil(pdf.data.length / 1024)} KB)` : "no PDF";
    console.log(`- ${email.receivedAt}  ${pdfInfo.padEnd(48)}  “${clean(email.subject)}”`);
    for (const note of notes) console.log(`    note: ${clean(note)}`);
  }
}

main().catch((err) => {
  // GmailError messages are safe to print (no secrets); other errors print their message only.
  const auth = err instanceof GmailError && err.authFailed;
  const message = err instanceof Error ? err.message : String(err);
  console.error(`${auth ? "Gmail authentication failed" : "Error"}: ${clean(message)}`);
  process.exit(1);
});
