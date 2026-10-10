// Server-only: renders PDF pages to PNG data URLs with MuPDF (WASM), and reads
// the PDF's text layer.
//
// Vision models get the pages as images because the Nicrron gateway drops PDF
// file parts. Pages are rendered WITHOUT an alpha channel on an opaque white
// background: a transparent background is decoded as black by some models.
//
// The text layer is never shown to a model. Plain code uses it to check that
// every quote a model gives really appears in the PDF.
//
// mupdf is ESM-only and initialises its WASM with top-level await, so it is
// loaded with a dynamic import. Verified from tsx scripts only; a Next.js route
// handler (Phase 3) will likely need "mupdf" in serverExternalPackages.

type MuPDF = typeof import("mupdf");
type MuDocument = ReturnType<MuPDF["Document"]["openDocument"]>;

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

export interface PdfContent extends PdfImages {
  /** Text layer of the same pages, or null when there is none (e.g. a scan). */
  text: string | null;
}

interface PdfOptions {
  maxPages?: number;
  scale?: number;
}

function pageLimit(opts?: PdfOptions): number {
  return Math.max(1, Math.floor(opts?.maxPages ?? 3));
}

/** Opens the PDF, hands it to `fn`, and always frees it afterwards. */
async function withDocument<T>(pdf: Uint8Array, fn: (mupdf: MuPDF, doc: MuDocument) => T): Promise<T> {
  const mupdf = await loadMupdf();
  const doc = mupdf.Document.openDocument(pdf, "application/pdf");
  try {
    return fn(mupdf, doc);
  } finally {
    doc.destroy();
  }
}

function renderPages(mupdf: MuPDF, doc: MuDocument, maxPages: number, opts?: PdfOptions): string[] {
  const scale = opts?.scale !== undefined && Number.isFinite(opts.scale) && opts.scale > 0 ? opts.scale : 2;
  const images: string[] = [];
  const matrix = mupdf.Matrix.scale(scale, scale);

  for (let i = 0; i < Math.min(doc.countPages(), maxPages); i++) {
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
  return images;
}

function readText(doc: MuDocument, maxPages: number): string | null {
  const texts: string[] = [];
  for (let i = 0; i < Math.min(doc.countPages(), maxPages); i++) {
    const page = doc.loadPage(i);
    try {
      const stext = page.toStructuredText("preserve-whitespace");
      try {
        texts.push(stext.asText());
      } finally {
        stext.destroy();
      }
    } finally {
      page.destroy();
    }
  }
  const text = texts.join("\n");
  return text.trim() ? text : null;
}

export async function pdfToPngDataUrls(pdf: Uint8Array, opts?: PdfOptions): Promise<PdfImages> {
  return withDocument(pdf, (mupdf, doc) => ({
    pages: doc.countPages(),
    images: renderPages(mupdf, doc, pageLimit(opts), opts),
  }));
}

/** Page images and text layer of the same pages, opening the document once. */
export async function readPdf(pdf: Uint8Array, opts?: PdfOptions): Promise<PdfContent> {
  return withDocument(pdf, (mupdf, doc) => {
    const maxPages = pageLimit(opts);
    return {
      pages: doc.countPages(),
      images: renderPages(mupdf, doc, maxPages, opts),
      text: readText(doc, maxPages),
    };
  });
}
