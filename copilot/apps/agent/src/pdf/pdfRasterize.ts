import type { PageImage, PdfRasterizePort } from "@copilot/ingestion";

/**
 * The concrete in-process PDF→raster implementation of `@copilot/ingestion`'s `PdfRasterizePort`
 * (`docs/decisions/w2-pdf-rasterizer.md`, spec `docs/specs/w2-pdf-rasterize.md`). Renders an
 * uploaded PDF's pages to PNG page images with `pdfjs-dist` + `@napi-rs/canvas`; the output feeds
 * both the VLM and the OCR. Mirrors the OCR adapter: the app owns the live engine, the pure package
 * owns only the `PdfRasterizePort` contract — so `packages/*` never imports pdfjs/canvas.
 */

/** Render scale (≈150 DPI at scale 2) — matched the committed golden's fidelity and OCR'd cleanly. */
const DEFAULT_SCALE = 2;
/** A lab/intake doc is 1–2 pages; cap the page *count* (memory is also bounded per-page, below). */
const DEFAULT_MAX_PAGES = 20;
/** Per-page pixel-area cap (~40 MP). A US-Letter page at scale 2 is ~1.9 MP; this rejects a
 * pathological giant MediaBox that page-count alone can't bound, before allocating the canvas. */
const DEFAULT_MAX_PIXELS = 40_000_000;
/** Bound the PDF load and each page render so a crafted PDF degrades (PHI-free) instead of hanging. */
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * A PHI-free rasterization failure. The PDF/image bytes are PHI; a raw engine error may carry them,
 * so — like {@link OcrTransportError} — we re-throw only a static message and do NOT chain the
 * original as `cause` (`phi-and-secrets`).
 */
export class PdfRasterizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfRasterizeError";
  }
}

/**
 * The render seam: rasterize a PDF's pages to one PNG buffer each, in page order. Injected in tests
 * (offline, no pdfjs/canvas); defaults to the real `pdfjs-dist` + `@napi-rs/canvas` renderer.
 */
export type RenderPdfPages = (pdf: Uint8Array, scale: number) => Promise<readonly Buffer[]>;

/**
 * Reject with a PHI-free {@link PdfRasterizeError} if `p` does not settle within `ms`. A timeout
 * is our own static message (safe to surface); the underlying rejection propagates unchanged (to be
 * genericized by the caller — a raw engine error may carry bytes).
 */
async function withRasterTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new PdfRasterizeError(message)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

export interface PdfRasterizerOptions {
  /** Render scale (default 2 ≈150 DPI). */
  readonly scale?: number;
  /** Reject a document with more than this many pages (default 20). */
  readonly maxPages?: number;
  /** Reject a page whose rendered pixel area exceeds this (default ~40 MP). */
  readonly maxPixels?: number;
  /** Bound the PDF load and each page render (default 60s). */
  readonly timeoutMs?: number;
  /** Injected renderer for offline tests; defaults to the real pdfjs + canvas path. */
  readonly renderPdfPages?: RenderPdfPages;
}

interface RealRenderConfig {
  readonly maxPages: number;
  readonly maxPixels: number;
  readonly timeoutMs: number;
}

/** The real renderer: `pdfjs-dist` (legacy build) rendering each page onto an `@napi-rs/canvas`. */
function realRenderPdfPages(config: RealRenderConfig): RenderPdfPages {
  const { maxPages, maxPixels, timeoutMs } = config;
  return async (pdf, scale) => {
    // Lazy imports so the PDF engine + native canvas load only when a real upload is rasterized.
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const { createCanvas } = await import("@napi-rs/canvas");

    // Copy into a fresh, unpooled Uint8Array first. pdfjs may TRANSFER (detach) the backing
    // ArrayBuffer, and a pooled Node Buffer (from readFileSync, or a Buffer-backed FHIR Binary)
    // shares its ArrayBuffer — passing it directly makes the render fail ("PDF rasterization failed").
    // The copy makes rasterization robust to any Uint8Array/Buffer the fetch port returns.
    const data = new Uint8Array(pdf);
    const loadingTask = pdfjs.getDocument({ data, disableFontFace: true, useSystemFonts: true });
    try {
      // Load inside the try so a load failure/timeout still destroys the loading task (no worker leak).
      const doc = await withRasterTimeout(loadingTask.promise, timeoutMs, "PDF load timed out");
      if (doc.numPages > maxPages) {
        throw new PdfRasterizeError(`PDF has ${doc.numPages} pages, exceeding the ${maxPages}-page limit`);
      }
      const buffers: Buffer[] = [];
      for (let n = 1; n <= doc.numPages; n += 1) {
        const page = await doc.getPage(n);
        try {
          const viewport = page.getViewport({ scale });
          const width = Math.ceil(viewport.width);
          const height = Math.ceil(viewport.height);
          if (width * height > maxPixels) {
            // A pathological giant MediaBox — reject before allocating the canvas (OOM guard).
            throw new PdfRasterizeError(
              `PDF page ${n} renders to ${width}x${height}px, exceeding the ${maxPixels}-pixel limit`,
            );
          }
          const canvas = createCanvas(width, height);
          const ctx = canvas.getContext("2d");
          // pdfjs's render params are typed against browser DOM canvas types (absent from the Node
          // lib); @napi-rs/canvas is API-compatible for rendering. Cast the params object once, at
          // this single engine boundary, via the inferred parameter type — no DOM type names.
          type RenderParams = Parameters<typeof page.render>[0];
          const task = page.render({ canvasContext: ctx, viewport, canvas } as unknown as RenderParams);
          await withRasterTimeout(task.promise, timeoutMs, `PDF page ${n} render timed out`);
          buffers.push(canvas.toBuffer("image/png"));
        } finally {
          page.cleanup();
        }
      }
      return buffers;
    } catch (e) {
      // Preserve our own PHI-free errors (cap breaches, timeouts); genericize any other engine error
      // (whose message may carry document bytes) — never forward it. Symmetric with the port's catch.
      throw e instanceof PdfRasterizeError ? e : new PdfRasterizeError("PDF rasterization failed");
    } finally {
      await loadingTask.destroy();
    }
  };
}

/**
 * Build the in-process PDF→raster {@link PdfRasterizePort}: render each page to a PNG and map it to
 * a base64 {@link PageImage} with a 1-based page number. A zero-page result or a render failure
 * throws a PHI-free {@link PdfRasterizeError} — never a silent empty set that would degrade
 * extraction to nothing.
 */
export function createPdfRasterizer(options?: PdfRasterizerOptions): PdfRasterizePort {
  const scale = options?.scale ?? DEFAULT_SCALE;
  const maxPages = options?.maxPages ?? DEFAULT_MAX_PAGES;
  const render =
    options?.renderPdfPages ??
    realRenderPdfPages({
      maxPages,
      maxPixels: options?.maxPixels ?? DEFAULT_MAX_PIXELS,
      timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });

  return async (pdf): Promise<readonly PageImage[]> => {
    let buffers: readonly Buffer[];
    try {
      buffers = await render(pdf, scale);
    } catch (e) {
      // A PdfRasterizeError from the seam (e.g. the page-cap breach) is already PHI-free — keep it.
      if (e instanceof PdfRasterizeError) {
        throw e;
      }
      // Any other error may carry PDF/image bytes — re-throw PHI-free, dropping the original.
      throw new PdfRasterizeError("PDF rasterization failed");
    }

    if (buffers.length > maxPages) {
      throw new PdfRasterizeError(`PDF has ${buffers.length} pages, exceeding the ${maxPages}-page limit`);
    }
    if (buffers.length === 0) {
      throw new PdfRasterizeError("PDF rendered zero pages");
    }

    return buffers.map((png, i) => ({
      page: i + 1,
      mediaType: "image/png",
      base64: png.toString("base64"),
    }));
  };
}
