import type { Citation } from "./citation.js";
import { locateValue, type LocatedLabResult, type OcrPage } from "./boxMatch.js";
import type { LabResult } from "./schemas/labPdf.js";
import type { ReferralFaxExtraction, ReferralField } from "./schemas/referralFax.js";

/**
 * Flatten a `referral_fax` extraction into the SAME `LocatedLabResult[]` shape the lab / intake /
 * medication-list pipelines produce, so the existing review UI + write path render it unchanged.
 * Each present referral field becomes one labeled value, box-matched against the OCR page with the
 * shared `locateValue` helper — a value with no located box is forced to review, never dropped
 * (`w2-document-ingestion-writes`). Absent fields are omitted (absence ≠ empty row). Labels are
 * unique per field, so no numbering is needed (no write-path key collision).
 *
 * Spec: `docs/specs/w2-referral-fax-ingestion.md`. Mirrors {@link locateMedicationListValues}.
 */

/** The fixed, stable field order → its review label. Absent fields are skipped. */
const FIELD_LABELS: ReadonlyArray<readonly [keyof Omit<ReferralFaxExtraction, "docType" | "citation">, string]> = [
  ["referralDate", "Referral date"],
  ["referringProvider", "Referring provider"],
  ["referredTo", "Referred to"],
  ["reason", "Reason for referral"],
  ["diagnosis", "Diagnosis"],
];

export function locateReferralFaxValues(
  extraction: ReferralFaxExtraction,
  ocr: OcrPage,
): { readonly results: readonly LocatedLabResult[] } {
  const results: LocatedLabResult[] = [];
  for (const [key, label] of FIELD_LABELS) {
    const field: ReferralField | undefined = extraction[key];
    if (field === undefined) {
      continue; // absent field — omit rather than emit an empty, unlocatable row
    }
    const found = locateValue(field.value, ocr);
    const citation: Citation =
      found.state === "located" ? { ...field.citation, locator: found.box } : field.citation;
    const result: LabResult = {
      testName: label,
      value: field.value,
      abnormalFlag: "unknown",
      citation,
      confidence: field.confidence,
    };
    results.push({ result, match: { state: found.state, boxConfidence: found.boxConfidence } });
  }
  return { results };
}
