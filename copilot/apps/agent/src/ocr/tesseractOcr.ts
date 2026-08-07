import {
  normalizeOcrWords,
  parseOcrPage,
  type OcrPort,
  type OcrPage,
  type OcrWord,
  type RawOcrWord,
} from "@copilot/ingestion";
import { withTimeout } from "../util/timeout.js";

/**
 * The concrete in-process `tesseract.js` implementation of `@copilot/ingestion`'s `OcrPort`
 * (`docs/decisions/w2-ocr-engine.md`, spec `docs/specs/w2-ocr-live-adapter.md`). The live
 * front-desk-upload path uses this to OCR an uploaded page raster; CI stays on the committed
 * golden maps. Mirrors `createClaudeVlm`: the app owns the live engine call, the pure package
 * (`normalizeOcrWords`) owns the pixel→[0,1] contract — so `packages/*` never imports Tesseract.
 */

/** OCR is low-volume (once per upload) but slower than a text call — a generous default bound. */
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * A PHI-free OCR failure. The page image is PHI; a raw engine/transport error may carry image
 * bytes, so — like {@link VlmTransportError} — we re-throw only a message + optional code and do
 * NOT chain the original as `cause` (`phi-and-secrets`).
 */
export class OcrTransportError extends Error {
  readonly statusCode: number | undefined;
  constructor(message: string, statusCode: number | undefined) {
    super(message);
    this.name = "OcrTransportError";
    this.statusCode = statusCode;
  }
}

/** Raw OCR of one page raster: recognized words (pixel boxes) + the raster's pixel dimensions. */
export interface RecognizeResult {
  readonly words: readonly RawOcrWord[];
  readonly width: number;
  readonly height: number;
}

/**
 * The OCR-engine seam: recognize one page raster's words + dimensions. Injected in tests
 * (offline, no WASM); defaults to the real in-process `tesseract.js` recognizer.
 */
export type RunRecognize = (image: Buffer) => Promise<RecognizeResult>;

export interface TesseractOcrOptions {
  /** Abort one page's OCR after this many ms (default 60s). */
  readonly timeoutMs?: number;
  /** Injected recognizer for offline tests; defaults to the real `tesseract.js` path. */
  readonly runRecognize?: RunRecognize;
}

/** Extract a numeric HTTP/engine status from an unknown error, if present. PHI-free. */
function statusCodeOf(e: unknown): number | undefined {
  if (typeof e === "object" && e !== null && "statusCode" in e) {
    const code = (e as { statusCode: unknown }).statusCode;
    if (typeof code === "number") {
      return code;
    }
  }
  return undefined;
}

/** The 8-byte PNG magic number. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Read a PNG's pixel dimensions from its IHDR chunk (width at byte 16, height at 20, big-endian).
 * Verifies the PNG signature + a minimum length first: a non-PNG raster (or a truncated buffer)
 * would otherwise yield garbage dimensions and a silently misleading map. Throws a PHI-free error
 * (no image bytes) otherwise. (Slice 2b may introduce non-PNG rasters — see the spec open question.)
 */
export function pngSize(buf: Buffer): { width: number; height: number } {
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("OCR raster is not a valid PNG (bad signature or truncated)");
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * Flatten tesseract.js v7's block→paragraph→line→word tree into a flat raw-word list. Keeps only
 * words with string text and a bbox whose four coordinates are all finite numbers — a malformed
 * bbox is dropped here so it can never become a NaN box downstream.
 */
export function flattenTesseractWords(data: unknown): RawOcrWord[] {
  const out: RawOcrWord[] = [];
  const d = data as {
    blocks?: Array<{
      paragraphs?: Array<{ lines?: Array<{ words?: Array<{ text?: unknown; bbox?: unknown }> }> }>;
    }>;
  };
  for (const b of d.blocks ?? []) {
    for (const p of b.paragraphs ?? []) {
      for (const l of p.lines ?? []) {
        for (const w of l.words ?? []) {
          if (typeof w.text !== "string") {
            continue;
          }
          const bbox = w.bbox as Partial<RawOcrWord["bbox"]> | undefined;
          if (
            bbox === undefined ||
            ![bbox.x0, bbox.y0, bbox.x1, bbox.y1].every((c) => typeof c === "number" && Number.isFinite(c))
          ) {
            continue;
          }
          out.push({ text: w.text, bbox: bbox as RawOcrWord["bbox"] });
        }
      }
    }
  }
  return out;
}

/** The real recognizer: a fresh in-process `tesseract.js` worker per call, terminated after. */
function realRunRecognize(): RunRecognize {
  return async (image) => {
    // Lazy import so the WASM engine loads only when OCR actually runs, not at agent boot.
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng");
    try {
      const { data } = await worker.recognize(image, {}, { blocks: true, text: true });
      const { width, height } = pngSize(image);
      return { words: flattenTesseractWords(data), width, height };
    } finally {
      await worker.terminate();
    }
  };
}

/**
 * Build the in-process `tesseract.js` {@link OcrPort}. For each page image: decode the base64,
 * recognize its words, and normalize them to [0,1] boxes stamped with the page number
 * (`normalizeOcrWords`), concatenating all pages into one {@link OcrPage}. A recognition failure
 * re-throws as a PHI-free {@link OcrTransportError}.
 */
export function createTesseractOcr(options?: TesseractOcrOptions): OcrPort {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const recognize = options?.runRecognize ?? realRunRecognize();

  return async (request): Promise<OcrPage> => {
    if (request.pages.length === 0) {
      // A caller bug — OCR with no pages would produce an empty map that degrades every value to
      // "unverified". Fail fast, matching the VLM adapter's empty-pages guard.
      throw new Error("createTesseractOcr: no pages to OCR");
    }
    const words: OcrWord[] = [];
    for (const page of request.pages) {
      const image = Buffer.from(page.base64, "base64");
      let result: RecognizeResult;
      try {
        result = await withTimeout(recognize(image), timeoutMs, `OCR timed out for page ${page.page}`);
      } catch (e) {
        // Never let the original (which may hold image bytes) propagate — PHI-free re-throw.
        throw new OcrTransportError(`OCR failed for page ${page.page}`, statusCodeOf(e));
      }
      words.push(...normalizeOcrWords(result.words, result.width, result.height, page.page));
    }
    // Fail loud on a malformed box, symmetric with the committed-map path (w2-document-ingestion-
    // writes: never a misleading/silent map). Valid by construction today, but the gate makes it
    // provable rather than incidental. PHI-free — the assembled page carries coordinates, not image bytes.
    return parseOcrPage({ words });
  };
}
