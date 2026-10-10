// Server-only: renders PDF pages to PNG data URLs with MuPDF (WASM).
//
// Vision models get the pages as images because the Nicrron gateway drops PDF
// file parts. Pages are rendered WITHOUT an alpha channel on an opaque white
// background: a transparent background is decoded as black by some models.
//
// mupdf is ESM-only and initialises its WASM with top-level await, so it is
// loaded with a dynamic import. That works from tsx scripts (CommonJS) and from
// Next.js route handlers alike.

type MuPDF = typeof import("mupdf");

let mupdfPromise: Promise<MuPDF> | null = null;

function loadMupdf(): Promise<MuPDF> {
  mupdfPromise ??= import("mupdf").catch((err) => {
    mupdfPromise = null; // allow a retry after a failed load
    throw err;
  });
  return mupdfPromise;
}

export interface PdfImages {
  /** Total number of pages in the document (may be more than were rendered). */
  pages: number;
  /** `data:image/png;base64,...` URLs, one per rendered page, in page order. */
  images: string[];
}

export async function pdfToPngDataUrls(
  pdf: Uint8Array,
  opts?: { maxPages?: number; scale?: number },
): Promise<PdfImages> {
  const maxPages = Math.max(1, Math.floor(opts?.maxPages ?? 3));
  const scale = opts?.scale !== undefined && Number.isFinite(opts.scale) && opts.scale > 0 ? opts.scale : 2;

  const mupdf = await loadMupdf();
  const doc = mupdf.Document.openDocument(pdf, "application/pdf");
  try {
    const pages = doc.countPages();
    const images: string[] = [];
    const matrix = mupdf.Matrix.scale(scale, scale);

    for (let i = 0; i < Math.min(pages, maxPages); i++) {
      const page = doc.loadPage(i);
      try {
        // alpha = false: MuPDF clears the pixmap to opaque white before drawing.
        const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true);
        try {
          const png = pixmap.asPNG();
          images.push(`data:image/png;base64,${Buffer.from(png).toString("base64")}`);
        } finally {
          pixmap.destroy();
        }
      } finally {
        page.destroy();
      }
    }

    return { pages, images };
  } finally {
    doc.destroy();
  }
}
