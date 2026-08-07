import type { BoundingBox } from "./citation.js";
import type { LabPdfExtraction, LabResult } from "./schemas/labPdf.js";

/**
 * The pure OCR box-match: locate an extracted value on the page and classify the match
 * three ways — the hallucination cross-check between what the VLM *said* and what the page
 * *shows* (`../../W2_ARCHITECTURE.md §4.2–4.3`, `w2-document-ingestion-writes`). It consumes an
 * OCR word→coordinate map as INPUT (it does not run OCR), so it is offline-testable and commits
 * to no OCR engine.
 */

/** One OCR-recognized word and its [0,1]-normalized box (`box.page` is 1-based). */
export interface OcrWord {
  readonly text: string;
  readonly box: BoundingBox;
}

/** The OCR word map for a single page. */
export interface OcrPage {
  readonly words: readonly OcrWord[];
}

export type MatchState = "located" | "approximate" | "unverified";

/**
 * Where an extracted value was found on the page. `located` carries the tight box; the other
 * two carry none (the citation degrades to page/section — it is never dropped).
 */
export type LocateResult =
  | { readonly state: "located"; readonly box: BoundingBox; readonly boxConfidence: number }
  | { readonly state: "approximate"; readonly boxConfidence: number }
  | { readonly state: "unverified"; readonly boxConfidence: number };

const CONF_LOCATED = 1;
const CONF_APPROXIMATE = 0.5;

/** Normalize for comparison: lowercase, trim, collapse internal whitespace. */
function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

/** The space-stripped form used for contiguous-run comparison (OCR spacing is unreliable). */
function compact(s: string): string {
  return normalize(s).replace(/\s+/g, "");
}

/** Union of same-page boxes: the smallest box covering them all. */
function unionBox(boxes: readonly BoundingBox[]): BoundingBox {
  const first = boxes[0];
  if (first === undefined) {
    throw new Error("unionBox: no boxes");
  }
  let x = first.x;
  let y = first.y;
  let right = first.x + first.w;
  let bottom = first.y + first.h;
  for (const b of boxes) {
    x = Math.min(x, b.x);
    y = Math.min(y, b.y);
    right = Math.max(right, b.x + b.w);
    bottom = Math.max(bottom, b.y + b.h);
  }
  return { page: first.page, x, y, w: right - x, h: bottom - y };
}

/**
 * Locate `value` in the OCR words. A target may span a contiguous run of words (`"150/80"` →
 * `"150" "/" "80"`); the compared form strips spaces so OCR tokenization drift does not cause a
 * false miss. Returns the three-way outcome — never a silent fill (`w2-document-ingestion-writes`).
 */
export function locateValue(value: string, ocr: OcrPage): LocateResult {
  const target = compact(value);
  if (target === "") {
    // A blank/empty cell cannot be located — force it to review, never trivially "match".
    return { state: "unverified", boxConfidence: 0 };
  }

  const words = ocr.words;
  // Contiguous-run match: from each start index, accumulate compacted word text until it equals
  // the target (located) or overshoots the target length (this start fails). A run never crosses
  // a page boundary, so the union box is always single-page.
  for (let i = 0; i < words.length; i += 1) {
    const start = words[i];
    if (start === undefined) {
      continue;
    }
    const runPage = start.box.page;
    let acc = "";
    const run: BoundingBox[] = [];
    for (let j = i; j < words.length; j += 1) {
      const w = words[j];
      if (w === undefined || w.box.page !== runPage) {
        break; // stop the run at a missing word or a page change — never union across pages
      }
      acc += compact(w.text);
      run.push(w.box);
      if (acc === target) {
        return { state: "located", box: unionBox(run), boxConfidence: CONF_LOCATED };
      }
      if (acc.length >= target.length) {
        break; // overshot without matching — try the next start
      }
    }
  }

  // Approximate: every whitespace-token of the target appears as a WHOLE word on the page, just
  // not as one contiguous run (a genuinely present multi-token value that OCR split/reordered) —
  // cite page/section, flag "location approximate". Whole-word (not substring): a fabricated
  // value must NOT read as present merely because its digits are a substring of a different
  // number (e.g. "40" inside "140") — that value is not on the page and is forced to review.
  const tokens = normalize(value).split(" ").filter((t) => t !== "");
  const allTokensOnPage = tokens.every((tok) => {
    const t = compact(tok);
    return words.some((w) => compact(w.text) === t);
  });
  if (allTokensOnPage) {
    return { state: "approximate", boxConfidence: CONF_APPROXIMATE };
  }

  // Not on the page at all — possible VLM hallucination / failed scan region.
  return { state: "unverified", boxConfidence: 0 };
}

/** A lab result enriched with its box-match outcome. */
export interface LocatedLabResult {
  /** The result with `citation.locator` set when `located` (absent otherwise). */
  readonly result: LabResult;
  readonly match: { readonly state: MatchState; readonly boxConfidence: number };
}

export interface LocatedLabExtraction {
  readonly docType: "lab_pdf";
  readonly results: readonly LocatedLabResult[];
}

/**
 * Enrich a lab extraction: locate each result's value on the page, set `citation.locator` when a
 * tight box was found, and attach the per-result match state. A citation is **never dropped** —
 * an approximate/unverified result keeps its page/section citation and is flagged for review.
 */
export function locateLabResults(extraction: LabPdfExtraction, ocr: OcrPage): LocatedLabExtraction {
  const results = extraction.results.map((result): LocatedLabResult => {
    const found = locateValue(result.value, ocr);
    const result2: LabResult =
      found.state === "located"
        ? { ...result, citation: { ...result.citation, locator: found.box } }
        : result;
    return { result: result2, match: { state: found.state, boxConfidence: found.boxConfidence } };
  });
  return { docType: "lab_pdf", results };
}
