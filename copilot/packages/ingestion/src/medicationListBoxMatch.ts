import type { Citation } from "./citation.js";
import { locateValue, type LocatedLabResult, type OcrPage } from "./boxMatch.js";
import type { LabResult } from "./schemas/labPdf.js";
import type { MedicationListExtraction } from "./schemas/medicationList.js";

/**
 * Flatten a `medication_list` extraction into the SAME `LocatedLabResult[]` shape the lab + intake
 * pipelines produce, so the existing review UI + write path render it unchanged. Each medication
 * becomes one labeled value, box-matched against the OCR page with the shared `locateValue` helper —
 * a value with no located box is forced to review, never dropped (`w2-document-ingestion-writes`).
 *
 * Spec: `docs/specs/w2-medication-list-ingestion.md`. Mirrors {@link locateIntakeValues}.
 */

/** Present, non-blank text, or `undefined` — a whitespace-only field is treated as absent. */
function present(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : value;
}

/**
 * Locate every medication on the OCR page and return them as `LocatedLabResult[]`. Each entry is
 * NUMBERED by its stable position (`Medication 1`, `Medication 2`, …) so every value has a UNIQUE
 * label/key: the write path keys "one active value per (document, code)", and without a unique key
 * committing N medications (all coded "Medication") would make each supersede/void the previous —
 * silent data loss. The index is stable (deterministic extraction), so it survives an edit + re-open.
 *
 * The display `value` carries the printed status ("Metformin 1000 mg daily (active)"); the
 * `matchText` is the status-free medication text (the status word may not sit next to the drug on
 * the page), so both the box-match and the anti-hallucination cross-check use only page-present words.
 */
export function locateMedicationListValues(
  extraction: MedicationListExtraction,
  ocr: OcrPage,
): { readonly results: readonly LocatedLabResult[] } {
  const results = extraction.medications.map((med, i): LocatedLabResult => {
    const base = [med.name, present(med.dose), present(med.frequency)]
      .filter((p): p is string => p !== undefined)
      .join(" ");
    const status = present(med.status);
    const value = status !== undefined ? `${base} (${status})` : base;

    const found = locateValue(base, ocr);
    const citation: Citation =
      found.state === "located" ? { ...med.citation, locator: found.box } : med.citation;
    const result: LabResult = {
      testName: `Medication ${i + 1}`,
      value,
      abnormalFlag: "unknown",
      citation,
      confidence: med.confidence,
    };
    return { result, match: { state: found.state, boxConfidence: found.boxConfidence } };
  });
  return { results };
}
