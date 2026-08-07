import type { DocType } from "./extract.js";
import type { PendingDocument } from "./detect.js";

/**
 * Pure document-type classification by title heuristic — the caller picks the extraction path
 * (`ingestLabDocument` / `ingestIntakeDocument` / `ingestMedicationListDocument` /
 * `ingestReferralFaxDocument`) from the result. Order matters: a medication list / pharmacy
 * printout / med reconciliation → `medication_list` (checked FIRST, since "Medication
 * Reconciliation Form" also contains "form"); a referral / consult-request fax → `referral_fax`
 * (checked before intake, since "Referral Form" also contains "form"); a title naming intake /
 * registration / a new-patient form / a bare "form" word → `intake_form`; everything else defaults
 * to `lab_pdf` (the demo anchor). `\bform\b` is whole-word so "Information" does not misfire.
 *
 * Spec: `docs/specs/w2-referral-fax-ingestion.md`. A VLM/category classifier is a later refinement.
 */
// Separators are space OR hyphen so a filename ("bello-grace-medication-list.pdf") classifies too.
const MED_LIST_TITLE =
  /medication[\s-]+(list|record|reconciliation|history|summary)|\bmed(ication)?s?[\s-]+list\b|pharmacy[\s-]+(printout|record|list)|current[\s-]+medications/i;
const REFERRAL_TITLE = /referral|refer(ral)?[\s-]+fax|consult(ation)?[\s-]+request|\bconsult[\s-]+note\b/i;
const INTAKE_TITLE = /intake|registration|new[- ]?patient|\bform\b/i;

export function classifyDocType(doc: PendingDocument): DocType {
  if (MED_LIST_TITLE.test(doc.title)) {
    return "medication_list";
  }
  if (REFERRAL_TITLE.test(doc.title)) {
    return "referral_fax";
  }
  return INTAKE_TITLE.test(doc.title) ? "intake_form" : "lab_pdf";
}
