import type { PageImage } from "./extract.js";
import type { OcrPage } from "./boxMatch.js";

/**
 * The injected OCR boundary — the seam between the pure box-match and whatever produces the
 * word→coordinate map. Mirrors `VlmExtractPort`: pure packages import the *type* only; the
 * concrete live adapter (in-process `tesseract.js`, Slice 2) lives at the edge in `apps/agent`
 * (`orchestrator-only`, `docs/decisions/w2-ocr-engine.md`).
 */
export interface OcrRequest {
  readonly pages: readonly PageImage[];
}

export type OcrPort = (request: OcrRequest) => Promise<OcrPage>;

/**
 * A committed-map-backed port: returns a fixed {@link OcrPage} regardless of the request. This
 * is the CI/offline OCR source (a `*.ocr.json` golden loaded via `parseOcrMap`) and the test
 * double for the ingestion path — so integration tests run with no live OCR (`w2-eval-gate`).
 */
export function fromOcrMap(map: OcrPage): OcrPort {
  return async () => map;
}
