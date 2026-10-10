/**
 * Renders every PDF in data/demo/pdfs to PNG with the same helper the app uses,
 * so the pages can be eyeballed (and sent to a vision model) before a demo.
 *
 *   npx tsx scripts/render-pdfs.ts [outDir]
 *
 * outDir defaults to <os tmpdir>/rfqr-pdf-previews. Each PNG is also checked to
 * be opaque RGB (no alpha channel) with a white page background.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pdfToPngDataUrls } from "../src/lib/pdf-to-images";

const ROOT = path.resolve(__dirname, "..");
const PDF_DIR = path.join(ROOT, "data/demo/pdfs");

/** PNG IHDR colour type: 2 = RGB, 6 = RGBA, 0 = gray, 4 = gray + alpha. */
function pngColorType(png: Buffer): number {
  if (png.toString("ascii", 12, 16) !== "IHDR") throw new Error("not a PNG");
  return png[25];
}

async function checkOpaqueWhite(png: Buffer): Promise<string | null> {
  if (pngColorType(png) !== 2) return `PNG colour type ${pngColorType(png)} (expected 2 = RGB, no alpha)`;
  const mupdf = await import("mupdf");
  const image = new mupdf.Image(png);
  const pix = image.toPixmap();
  try {
    if (pix.getAlpha()) return "pixmap has an alpha channel";
    const w = pix.getWidth();
    const h = pix.getHeight();
    const n = pix.getNumberOfComponents();
    const stride = pix.getStride();
    const px = pix.getPixels();
    // Points that are page background in every layout: bottom corners and the left margin.
    const probes: [number, number][] = [
      [2, h - 3],
      [w - 3, h - 3],
      [4, Math.floor(h / 2)],
    ];
    for (const [x, y] of probes) {
      const o = y * stride + x * n;
      const rgb = [px[o], px[o + 1], px[o + 2]];
      if (rgb.some((v) => v < 250)) return `pixel (${x},${y}) is rgb(${rgb.join(",")}), expected white`;
    }
    return null;
  } finally {
    pix.destroy();
    image.destroy();
  }
}

async function main() {
  const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), "rfqr-pdf-previews"));
  await mkdir(outDir, { recursive: true });

  const files = (await readdir(PDF_DIR)).filter((f) => f.toLowerCase().endsWith(".pdf")).sort();
  if (!files.length) throw new Error(`no PDFs in ${PDF_DIR} (run: npm run demo:pdfs)`);

  let failed = false;
  for (const file of files) {
    const t0 = performance.now();
    const { pages, images } = await pdfToPngDataUrls(new Uint8Array(await readFile(path.join(PDF_DIR, file))));
    const ms = performance.now() - t0;

    for (const [i, url] of images.entries()) {
      const png = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
      const out = path.join(outDir, `${path.basename(file, ".pdf")}-p${i + 1}.png`);
      await writeFile(out, png);
      const problem = await checkOpaqueWhite(png);
      if (problem) failed = true;
      console.log(
        `${file} p${i + 1}/${pages} -> ${out} (${(png.length / 1024).toFixed(0)} KB, ${ms.toFixed(0)} ms)` +
          (problem ? `  FAIL: ${problem}` : "  ok: opaque RGB, white background"),
      );
    }
  }
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
