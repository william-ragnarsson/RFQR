/**
 * Generates one buyer-issued spec sheet PDF per demo scenario.
 *
 *   npx tsx scripts/make-demo-pdfs.ts      (or: npm run demo:pdfs)
 *
 * Reads data/demo/scenarios.json and writes data/demo/pdfs/<scenario.pdf.file>.
 * The PDFs deliberately do NOT contain the order quantity: in the demo the
 * quantity lives only in the email body, the material spec only in the PDF.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PDFFont, PDFPage, RGB, StandardFonts, rgb } from "pdf-lib";

interface ScenarioPdf {
  file: string;
  buyer: string;
  docNo: string;
  title: string;
  project: string;
  rows: [string, string][];
  notes: string;
}

interface Scenario {
  id: string;
  title: string;
  expectedOutcome: string;
  email: { subject: string; body: string };
  pdf: ScenarioPdf;
}

interface ScenarioFile {
  seller: { name: string; company: string; role: string };
  scenarios: Scenario[];
}

type LogoKind = "ridge" | "wave" | "hex" | "square";

interface Brand {
  color: RGB;
  logo: LogoKind;
  department: string;
  date: Date; // issue date printed in the header
}

const ROOT = path.resolve(__dirname, "..");
const SCENARIOS = path.join(ROOT, "data/demo/scenarios.json");
const OUT_DIR = path.join(ROOT, "data/demo/pdfs");

// ---------------------------------------------------------------------------
// Look and feel
// ---------------------------------------------------------------------------

const hex = (h: string): RGB => {
  const n = parseInt(h.replace("#", ""), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

const INK = hex("#1B2430");
const BODY = hex("#2E3946");
const MUTED = hex("#667281");
const GRID = hex("#D3D9E0");
const GRID_OUTER = hex("#BCC5CF");
const STRIPE = hex("#F5F7F9");
const HEAD_FILL = hex("#E9EDF1");
const WHITE = rgb(1, 1, 1);

/** Per-buyer branding. Unknown buyers get a neutral fallback. */
const BRANDS: Record<string, Brand> = {
  "Ridgeway Fabrication": {
    color: hex("#34526F"), // muted steel blue
    logo: "ridge",
    department: "Purchasing Department",
    date: new Date(Date.UTC(2026, 9, 6)),
  },
  "Davies Marine Works": {
    color: hex("#2F6B68"), // muted teal
    logo: "wave",
    department: "Procurement & Engineering",
    date: new Date(Date.UTC(2026, 9, 2)),
  },
  "Coastal Food Equipment": {
    color: hex("#6B7F4E"), // muted olive green
    logo: "hex",
    department: "Procurement",
    date: new Date(Date.UTC(2026, 9, 8)),
  },
};

const FALLBACK_BRAND: Brand = {
  color: hex("#4F5B6B"),
  logo: "square",
  department: "Purchasing",
  date: new Date(Date.UTC(2026, 9, 5)),
};

// US Letter, 0.75 in margins
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 54;
const CONTENT_W = PAGE_W - MARGIN * 2;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Standard 14 fonts use WinAnsi encoding: map common Unicode punctuation, drop the rest. */
function winAnsi(s: string): string {
  const map: Record<string, string> = {
    "—": "-",
    "–": "-",
    "−": "-",
    "‘": "'",
    "’": "'",
    "“": '"',
    "”": '"',
    "…": "...",
    "×": "x",
    "″": '"',
    "′": "'",
    " ": " ",
  };
  let out = "";
  for (const ch of s) {
    if (map[ch] !== undefined) out += map[ch];
    else if (/[\x20-\x7E]/.test(ch)) out += ch;
    else out += "?";
  }
  return out;
}

function formatDate(d: Date): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(d.getUTCDate()).padStart(2, "0")} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Greedy word wrap. */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

/** Name of the person who signed the email (the line after the sign-off). */
function contactFromEmail(body: string): string {
  const lines = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const signOff = /^(kind regards|best regards|regards|best|thanks|thank you|many thanks|cheers|sincerely)[,.!]?$/i;
  const i = lines.findIndex((l) => signOff.test(l));
  if (i >= 0 && lines[i + 1]) return lines[i + 1];
  return lines.length >= 2 ? lines[lines.length - 2] : "";
}

/** The order quantity stated in the email, used to guard against leaking it into the PDF. */
function quantityFromEmail(body: string): string | null {
  const m = body.match(/\b(\d+)\s+sheets?\b/i);
  return m ? m[1] : null;
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

interface Ctx {
  page: PDFPage;
  regular: PDFFont;
  bold: PDFFont;
  drawn: string[]; // every string put on the page (for the quantity guard)
}

function text(
  ctx: Ctx,
  s: string,
  x: number,
  y: number,
  opts: { size: number; font?: PDFFont; color?: RGB; align?: "left" | "right" | "center" },
) {
  const font = opts.font ?? ctx.regular;
  const safe = winAnsi(s);
  const w = font.widthOfTextAtSize(safe, opts.size);
  const dx = opts.align === "right" ? -w : opts.align === "center" ? -w / 2 : 0;
  ctx.page.drawText(safe, { x: x + dx, y, size: opts.size, font, color: opts.color ?? INK });
  ctx.drawn.push(safe);
}

function hline(ctx: Ctx, x1: number, x2: number, y: number, thickness: number, color: RGB) {
  ctx.page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color });
}

/** Simple geometric logo mark, `size` points square, top-left corner at (x, yTop). */
function drawLogo(ctx: Ctx, kind: LogoKind, x: number, yTop: number, size: number, color: RGB) {
  const { page } = ctx;
  const s = size / 40; // paths below are authored in a 40 x 40 box, y pointing down
  switch (kind) {
    case "ridge": {
      page.drawSvgPath("M0 0 H40 V40 H0 Z", { x, y: yTop, scale: s, color });
      page.drawSvgPath("M5 31 L17 10 L29 31 Z", { x, y: yTop, scale: s, color: WHITE });
      page.drawSvgPath("M17 31 L26.5 16 L36 31 Z", {
        x,
        y: yTop,
        scale: s,
        color: WHITE,
        borderColor: color,
        borderWidth: 1.6,
      });
      page.drawSvgPath("M5 33.5 H36 V35.5 H5 Z", { x, y: yTop, scale: s, color: WHITE });
      break;
    }
    case "wave": {
      page.drawCircle({ x: x + size / 2, y: yTop - size / 2, size: size / 2, color });
      const wave = "M7 0 C11 -4 15 -4 20 0 C25 4 29 4 33 0";
      for (const dy of [15, 22, 29]) {
        page.drawSvgPath(wave, {
          x,
          y: yTop - dy * s,
          scale: s,
          borderColor: WHITE,
          borderWidth: 2.6,
          borderLineCap: 1,
        });
      }
      break;
    }
    case "hex": {
      page.drawSvgPath("M20 1 L37 10.5 L37 29.5 L20 39 L3 29.5 L3 10.5 Z", { x, y: yTop, scale: s, color });
      page.drawSvgPath("M20 9 L30 14.75 L30 25.25 L20 31 L10 25.25 L10 14.75 Z", {
        x,
        y: yTop,
        scale: s,
        borderColor: WHITE,
        borderWidth: 2.4,
      });
      page.drawSvgPath("M20 15 L25 18 L25 22 L20 25 L15 22 L15 18 Z", { x, y: yTop, scale: s, color: WHITE });
      break;
    }
    default: {
      page.drawRectangle({ x, y: yTop - size, width: size, height: size, color });
      page.drawRectangle({ x: x + size * 0.28, y: yTop - size * 0.72, width: size * 0.44, height: size * 0.44, color: WHITE });
    }
  }
}

function drawHeader(ctx: Ctx, pdf: ScenarioPdf, brand: Brand): number {
  const { page, bold } = ctx;

  // Thin brand band across the top edge
  page.drawRectangle({ x: 0, y: PAGE_H - 6, width: PAGE_W, height: 6, color: brand.color });

  const top = PAGE_H - 50;
  const logoSize = 38;
  drawLogo(ctx, brand.logo, MARGIN, top, logoSize, brand.color);

  const nameX = MARGIN + logoSize + 12;

  // Document info block, flush with the right margin
  const infoRows: [string, string][] = [
    ["Doc no.", pdf.docNo],
    ["Date", formatDate(brand.date)],
    ["Project", pdf.project],
  ];
  const titleSize = 12.5;
  const labelSize = 8.5;
  const valueSize = 9;
  const labelW = 46;
  const valuesW = Math.max(...infoRows.map(([, v]) => bold.widthOfTextAtSize(winAnsi(v), valueSize)));
  const titleW = bold.widthOfTextAtSize(winAnsi(pdf.title), titleSize);
  const blockW = Math.max(titleW, labelW + valuesW);
  const bx = PAGE_W - MARGIN - blockW;

  // Company name: shrink if a long name would run into the info block
  let nameSize = 19;
  while (nameSize > 12 && bold.widthOfTextAtSize(winAnsi(pdf.buyer), nameSize) > bx - nameX - 18) nameSize -= 0.5;
  text(ctx, pdf.buyer, nameX, top - 19, { size: nameSize, font: bold, color: INK });
  text(ctx, brand.department, nameX, top - 34, { size: 9, color: MUTED });

  text(ctx, pdf.title, bx, top - 10, { size: titleSize, font: bold, color: brand.color });
  let y = top - 26;
  for (const [label, value] of infoRows) {
    text(ctx, label, bx, y, { size: labelSize, color: MUTED });
    text(ctx, value, bx + labelW, y, { size: valueSize, font: bold, color: BODY });
    y -= 12.5;
  }

  const ruleY = Math.min(y + 2, top - logoSize - 10) - 8;
  hline(ctx, MARGIN, PAGE_W - MARGIN, ruleY, 1.2, brand.color);
  return ruleY;
}

function sectionTitle(ctx: Ctx, label: string, y: number, brand: Brand): number {
  text(ctx, label.toUpperCase(), MARGIN, y, { size: 9, font: ctx.bold, color: brand.color });
  return y - 10;
}

function drawTable(ctx: Ctx, rows: [string, string][], yTop: number): number {
  const { page, regular, bold } = ctx;
  const col1W = 168;
  const col2W = CONTENT_W - col1W;
  const padX = 10;
  const padY = 8;
  const size = 10;
  const lineH = 13;
  const capH = regular.heightAtSize(size, { descender: false }) * 0.72;

  const x0 = MARGIN;
  const x1 = MARGIN + col1W;
  const x2 = MARGIN + CONTENT_W;

  // Header row
  const headH = 24;
  let y = yTop;
  page.drawRectangle({ x: x0, y: y - headH, width: CONTENT_W, height: headH, color: HEAD_FILL });
  const headBase = y - headH / 2 - capH / 2 + 0.5;
  text(ctx, "Requirement", x0 + padX, headBase, { size: 9, font: bold, color: INK });
  text(ctx, "Value", x1 + padX, headBase, { size: 9, font: bold, color: INK });
  const rowLines: number[] = [y];
  y -= headH;
  rowLines.push(y);

  rows.forEach(([req, value], i) => {
    const reqLines = wrap(winAnsi(req), regular, size, col1W - padX * 2);
    const valLines = wrap(winAnsi(value), regular, size, col2W - padX * 2);
    const n = Math.max(reqLines.length, valLines.length);
    const h = padY * 2 + capH + (n - 1) * lineH + 4;
    if (i % 2 === 1) page.drawRectangle({ x: x0, y: y - h, width: CONTENT_W, height: h, color: STRIPE });
    const base = y - padY - capH - 2;
    reqLines.forEach((l, k) => text(ctx, l, x0 + padX, base - k * lineH, { size, color: BODY }));
    valLines.forEach((l, k) => text(ctx, l, x1 + padX, base - k * lineH, { size, color: INK }));
    y -= h;
    rowLines.push(y);
  });

  // Grid: horizontal lines, column divider, outer border
  rowLines.slice(1, -1).forEach((ly) => hline(ctx, x0, x2, ly, 0.6, GRID));
  page.drawLine({ start: { x: x1, y: yTop }, end: { x: x1, y }, thickness: 0.6, color: GRID });
  page.drawRectangle({ x: x0, y, width: CONTENT_W, height: yTop - y, borderColor: GRID_OUTER, borderWidth: 0.8 });
  return y;
}

function drawNotes(ctx: Ctx, notes: string, yTop: number, brand: Brand): number {
  let y = sectionTitle(ctx, "Notes", yTop, brand) - 8;
  const size = 9.5;
  const lineH = 13.5;
  const indent = 16;
  splitSentences(winAnsi(notes)).forEach((sentence, i) => {
    text(ctx, `${i + 1}.`, MARGIN, y, { size, color: MUTED });
    const lines = wrap(sentence, ctx.regular, size, CONTENT_W - indent);
    lines.forEach((line, k) => text(ctx, line, MARGIN + indent, y - k * lineH, { size, color: BODY }));
    y -= lines.length * lineH + 3;
  });
  return y;
}

function drawFooter(ctx: Ctx, preparedBy: string, docNo: string) {
  const ruleY = 78;
  hline(ctx, MARGIN, PAGE_W - MARGIN, ruleY, 0.6, GRID_OUTER);
  const y = ruleY - 18;
  const size = 9;

  text(ctx, "Prepared by:", MARGIN, y, { size, color: MUTED });
  text(ctx, preparedBy, MARGIN + ctx.regular.widthOfTextAtSize("Prepared by:", size) + 4, y, {
    size,
    font: ctx.bold,
    color: BODY,
  });

  text(ctx, "Approved: ____________", PAGE_W / 2 + 10, y, { size, color: MUTED, align: "center" });
  text(ctx, "Page 1 of 1", PAGE_W - MARGIN, y, { size, color: MUTED, align: "right" });

  const y2 = y - 14;
  text(ctx, `${docNo}  |  Uncontrolled when printed`, MARGIN, y2, { size: 7.5, color: MUTED });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function buildPdf(s: Scenario): Promise<{ bytes: Uint8Array; drawn: string[] }> {
  const brand = BRANDS[s.pdf.buyer] ?? FALLBACK_BRAND;
  const preparedBy = contactFromEmail(s.email.body);

  const doc = await PDFDocument.create();
  doc.setTitle(`${s.pdf.title} ${s.pdf.docNo}`);
  doc.setSubject(s.pdf.project);
  doc.setAuthor(preparedBy);
  doc.setCreator(`${s.pdf.buyer} (RFQR demo fixture)`);
  doc.setProducer("pdf-lib");
  doc.setCreationDate(brand.date);
  doc.setModificationDate(brand.date);

  const page = doc.addPage([PAGE_W, PAGE_H]);
  const ctx: Ctx = {
    page,
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    drawn: [],
  };

  let y = drawHeader(ctx, s.pdf, brand);
  y = sectionTitle(ctx, "Specification", y - 28, brand);
  y = drawTable(ctx, s.pdf.rows, y - 4);
  y = drawNotes(ctx, s.pdf.notes, y - 30, brand);
  drawFooter(ctx, preparedBy, s.pdf.docNo);

  if (y < 110) throw new Error(`${s.id}: content runs into the footer (y=${y.toFixed(0)})`);
  return { bytes: await doc.save(), drawn: ctx.drawn };
}

async function main() {
  const data = JSON.parse(await readFile(SCENARIOS, "utf8")) as ScenarioFile;
  await mkdir(OUT_DIR, { recursive: true });

  for (const s of data.scenarios) {
    const { bytes, drawn } = await buildPdf(s);

    // The quantity must only ever be in the email body.
    const qty = quantityFromEmail(s.email.body);
    if (qty) {
      const leak = drawn.find((t) => new RegExp(`(^|[^\\d.-])${qty}([^\\d.-]|$)`).test(t));
      if (leak) throw new Error(`${s.id}: quantity "${qty}" leaked into the PDF in "${leak}"`);
    }

    const out = path.join(OUT_DIR, s.pdf.file);
    await writeFile(out, bytes);
    console.log(`${s.id.padEnd(16)} -> ${path.relative(ROOT, out)} (${(bytes.length / 1024).toFixed(1)} KB)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
