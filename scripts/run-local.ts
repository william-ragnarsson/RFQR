/**
 * Runs the REAL pipeline (real AI calls through the gateway) on the demo
 * scenarios and checks each outcome against the one the scenario expects.
 *
 *   npm run demo:local [-- <scenarioId>|all]      (default: all; "2" = "2-missing-info")
 *
 * Each RFQ is built from data/demo/scenarios.json and the fixed spec sheets in
 * data/demo/pdfs. No Gmail here at all: nothing is read from or sent to a mailbox.
 * Exit code 1 if any scenario does not end with its expected outcome.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import scenariosData from "../data/demo/scenarios.json";
import { runPipeline } from "../src/lib/pipeline";
import type { RfqMessage } from "../src/lib/types";
import { printResult, timeline } from "./lib/print";

const PDF_DIR = path.resolve(__dirname, "../data/demo/pdfs");

type Scenario = (typeof scenariosData.scenarios)[number];

function pickScenarios(arg: string): Scenario[] {
  const all = scenariosData.scenarios;
  if (arg === "all") return all;
  const found = all.filter((s) => s.id === arg || s.id.startsWith(`${arg}-`));
  if (!found.length) {
    throw new Error(`Unknown scenario "${arg}". Use one of: all, ${all.map((s) => s.id).join(", ")}`);
  }
  return found;
}

async function buildRfq(s: Scenario): Promise<Pick<RfqMessage, "email" | "pdf">> {
  const data = new Uint8Array(await readFile(path.join(PDF_DIR, s.pdf.file)));
  return {
    email: {
      id: `local-${s.id}`,
      threadId: `local-${s.id}`,
      from: s.email.from,
      to: process.env.RFQ_ADDRESS?.trim() || "rfq@northline.example",
      subject: s.email.subject,
      body: s.email.body,
      receivedAt: new Date().toISOString(),
      attachment: { filename: s.pdf.file, pages: 0 },
    },
    pdf: { filename: s.pdf.file, data },
  };
}

async function main() {
  const scenarios = pickScenarios(process.argv[2] ?? "all");
  const results: { id: string; pass: boolean; line: string }[] = [];

  for (const s of scenarios) {
    console.log(`\n=== ${s.id}: ${s.title} ===`);
    console.log(`From ${s.email.from}: ${s.email.subject} (PDF: ${s.pdf.file})\n`);

    const t0 = Date.now();
    const final = await runPipeline(await buildRfq(s), timeline());
    printResult(final);

    const outcome = final.reply?.outcome ?? (final.error ? "run failed" : "no reply");
    const pass = outcome === s.expectedOutcome;
    const line = `${pass ? "PASS" : "FAIL"}  ${s.id}: ${outcome} (expected ${s.expectedOutcome}), ${((Date.now() - t0) / 1000).toFixed(1)} s`;
    console.log(`\n${line}`);
    results.push({ id: s.id, pass, line });
  }

  if (results.length > 1) {
    console.log("\n=== Summary ===");
    for (const r of results) console.log(r.line);
  }
  if (results.some((r) => !r.pass)) process.exit(1);
}

main().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
