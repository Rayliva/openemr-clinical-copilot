import type { OcrWord } from "./boxMatch.js";

/**
 * Pure, engine-agnostic normalization of an OCR engine's raw word output into the `OcrWord`
 * shape the box-match consumes. Shared by the live `tesseract.js` adapter (`apps/agent`) and,
 * in spirit, the build-time golden generator — kept here so `@copilot/ingestion` owns the
 * OCR→OcrPage contract with NO OCR-engine dependency (`orchestrator-only`,
 * `docs/decisions/w2-ocr-engine.md`). No IO, deterministic.
 */

/** One recognized word with its **pixel** bounding box, as an OCR engine reports it. */
export interface RawOcrWord {
  readonly text: string;
  readonly bbox: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
}

/** Clamp to [0,1] and round to 5 decimals — identical to the committed-map generator so the
 * live OCR path and the offline golden produce the same normalized boxes. */
function norm(pixels: number, span: number): number {
  return Math.round(Math.min(1, Math.max(0, pixels / span)) * 1e5) / 1e5;
}

/**
 * Normalize raw OCR words (pixel boxes) into `OcrWord[]` with [0,1] boxes stamped with `page`.
 *
 * Drops words whose trimmed text is empty (no matchable text — the committed golden never carries
 * them either). **Throws** on a non-positive raster dimension or `page < 1`: boxes normalized
 * against a zero dimension would be meaningless, so fail fast rather than emit a misleading map
 * (`w2-document-ingestion-writes`: never a silent fill).
 */
export function normalizeOcrWords(
  words: readonly RawOcrWord[],
  imageWidth: number,
  imageHeight: number,
  page: number,
): OcrWord[] {
  if (!(imageWidth > 0) || !(imageHeight > 0)) {
    throw new Error(`normalizeOcrWords: raster dimensions must be positive (got ${imageWidth}x${imageHeight})`);
  }
  if (!Number.isInteger(page) || page < 1) {
    throw new Error(`normalizeOcrWords: page must be a positive integer (got ${page})`);
  }

  const out: OcrWord[] = [];
  for (const raw of words) {
    const text = raw.text.trim();
    if (text === "") {
      continue;
    }
    // Drop a word with a non-finite input coordinate (NaN → a NaN box; ±Infinity → a box clamped
    // to the page edge — both misleading). The value it belonged to then falls to `unverified` /
    // forced-review (the safe degrade), never a silent misleading fill. Guard the INPUT, because
    // `norm` clamps Infinity to a *finite* edge value that an output check would miss.
    const { x0, y0, x1, y1 } = raw.bbox;
    if (![x0, y0, x1, y1].every(Number.isFinite)) {
      continue;
    }
    out.push({
      text,
      box: {
        page,
        x: norm(x0, imageWidth),
        y: norm(y0, imageHeight),
        w: norm(x1 - x0, imageWidth),
        h: norm(y1 - y0, imageHeight),
      },
    });
  }
  return out;
}
