import type { Citation } from "./citation.js";
import { locateValue, type LocatedLabResult, type OcrPage } from "./boxMatch.js";
import type { LabResult } from "./schemas/labPdf.js";
import type { IntakeFormExtraction } from "./schemas/intakeForm.js";

/**
 * Flatten an `intake_form` extraction into the SAME `LocatedLabResult[]` shape the lab pipeline
 * produces, so the existing review UI + service render it unchanged. Each demographics field,
 * medication, allergy, and family-history entry becomes one labeled value, box-matched against the
 * OCR page with the very helper `locateLabResults` uses (`locateValue`) — a value with no located
 * box is forced to review (`match.state`), never dropped (`w2-document-ingestion-writes`). It does
 * NOT reimplement the box-match or touch the lab path.
 *
 * Spec: `docs/specs/w2-intake-ingestion-pipeline.md`.
 */

/** Em dash (U+2014), the separator the intake form renders between substance/reaction and relation/condition. */
const EM_DASH = "—";

/** A direct header field carries no per-field model confidence; treat it as high-confidence. */
const DEMOGRAPHIC_CONFIDENCE = 1;

/** One flattened intake value awaiting box-match: everything a {@link LabResult} needs but the locator. */
interface FlatIntakeValue {
  readonly testName: string;
  /** The value shown to the physician — composites keep the em-dash separator ("Penicillin — rash"). */
  readonly value: string;
  /**
   * The text the box-matcher looks for on the page. For composites it is the SEPARATOR-FREE form
   * ("Penicillin rash") — the em-dash in {@link value} is a display artifact we synthesize, it is not
   * on the scanned form, so matching against it would force every allergy / family-history value to
   * review (the em-dash token is never on the page). Both component words must still be present, so
   * the anti-hallucination cross-check is preserved.
   */
  readonly matchText: string;
  readonly citation: Citation;
  readonly confidence: number;
}

/** Present, non-blank text, or `undefined` — a whitespace-only field is treated as absent. */
function present(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : value;
}

/**
 * Flatten the extraction into labeled values, in a stable order (demographics → medications →
 * allergies → family history). Demographics fields get a **synthesized** citation (the schema has
 * none per field); the other three reuse their extracted citation + confidence.
 */
function flattenIntake(extraction: IntakeFormExtraction): FlatIntakeValue[] {
  const flat: FlatIntakeValue[] = [];
  const sourceId = extraction.citation.sourceId;

  const demo = extraction.demographics;
  const demographicFields: ReadonlyArray<readonly [string, string, string | undefined]> = [
    ["Name", "name", demo.name],
    ["DOB", "dob", demo.dob],
    ["Sex", "sex", demo.sex],
    ["Phone", "phone", demo.phone],
    ["Address", "address", demo.address],
  ];
  for (const [testName, field, raw] of demographicFields) {
    const value = present(raw);
    if (value === undefined) {
      continue; // absent field — omit rather than emit an empty, unlocatable row
    }
    flat.push({
      testName,
      value,
      matchText: value,
      confidence: DEMOGRAPHIC_CONFIDENCE,
      citation: {
        sourceType: "intake_form",
        sourceId,
        pageOrSection: "Demographics",
        fieldOrChunkId: `demographics-${field}`,
        quoteOrValue: value,
      },
    });
  }

  // Repeated field types (medications, allergies, family history) are NUMBERED by their stable
  // position so each entry has a UNIQUE label/key. The write path keys "one active value per
  // (document, code)"; without a unique key, committing 3 medications (all coded "Medication") makes
  // each supersede/void the previous — silent data loss. The index is stable (deterministic
  // extraction), so it survives a physician value-edit and a re-open.
  extraction.currentMedications.forEach((med, i) => {
    const dose = present(med.dose);
    const value = dose !== undefined ? `${med.name} ${dose}` : med.name;
    flat.push({ testName: `Medication ${i + 1}`, value, matchText: value, citation: med.citation, confidence: med.confidence });
  });

  extraction.allergies.forEach((allergy, i) => {
    const reaction = present(allergy.reaction);
    // Display keeps the em-dash; matchText joins the parts with a space (the em-dash is not on the page).
    const value =
      reaction !== undefined ? `${allergy.substance} ${EM_DASH} ${reaction}` : allergy.substance;
    const matchText = reaction !== undefined ? `${allergy.substance} ${reaction}` : allergy.substance;
    flat.push({ testName: `Allergy ${i + 1}`, value, matchText, citation: allergy.citation, confidence: allergy.confidence });
  });

  extraction.familyHistory.forEach((fh, i) => {
    const relation = present(fh.relation);
    const value = relation !== undefined ? `${relation} ${EM_DASH} ${fh.condition}` : fh.condition;
    const matchText = relation !== undefined ? `${relation} ${fh.condition}` : fh.condition;
    flat.push({
      testName: `Family history ${i + 1}`,
      value,
      matchText,
      citation: fh.citation,
      confidence: fh.confidence,
    });
  });

  return flat;
}

/**
 * Locate every flattened intake value on the OCR page and return them as `LocatedLabResult[]` — the
 * exact shape `locateLabResults` returns per value, so a `LabIngestionDraft` built from these renders
 * in the unchanged review UI. On a `located` match the tight box is written to `citation.locator`; an
 * `approximate`/`unverified` value keeps its page/section citation and is flagged for review.
 */
export function locateIntakeValues(
  extraction: IntakeFormExtraction,
  ocr: OcrPage,
): { readonly results: readonly LocatedLabResult[] } {
  const results = flattenIntake(extraction).map((flat): LocatedLabResult => {
    const found = locateValue(flat.matchText, ocr);
    const citation: Citation =
      found.state === "located" ? { ...flat.citation, locator: found.box } : flat.citation;
    const result: LabResult = {
      testName: flat.testName,
      value: flat.value,
      abnormalFlag: "unknown",
      citation,
      confidence: flat.confidence,
    };
    return { result, match: { state: found.state, boxConfidence: found.boxConfidence } };
  });
  return { results };
}
