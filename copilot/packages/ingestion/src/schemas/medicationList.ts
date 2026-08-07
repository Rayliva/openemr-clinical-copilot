import { z } from "zod";
import { Citation } from "../citation.js";

/** Per-field confidence in [0,1] — drives physician-review attention (low-confidence forced up). */
const confidence = z.number().min(0).max(1);

/** One medication line on a medication-list / pharmacy-printout / med-reconciliation document. */
export const MedicationListItem = z.object({
  name: z.string().min(1),
  dose: z.string().optional(),
  frequency: z.string().optional(),
  /** Status exactly as printed (e.g. "active", "discontinued") — never inferred. */
  status: z.string().optional(),
  citation: Citation,
  confidence,
});
export type MedicationListItem = z.infer<typeof MedicationListItem>;

/**
 * The canonical contract for a `medication_list` extraction — the third document type (a pharmacy
 * printout / medication-reconciliation list). A flat list of medications, each with its own
 * citation + confidence. Raw VLM output is parsed against this (never bypasses it).
 */
export const MedicationListExtraction = z.object({
  docType: z.literal("medication_list"),
  medications: z.array(MedicationListItem),
  citation: Citation,
});
export type MedicationListExtraction = z.infer<typeof MedicationListExtraction>;
