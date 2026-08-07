import { z } from "zod";
import { Citation } from "../citation.js";

/** Per-field confidence in [0,1] — drives physician-review attention (low-confidence forced up). */
const confidence = z.number().min(0).max(1);

/** A medication listed on the intake form. */
export const IntakeMedication = z.object({
  name: z.string().min(1),
  dose: z.string().optional(),
  citation: Citation,
  confidence,
});
export type IntakeMedication = z.infer<typeof IntakeMedication>;

/** An allergy listed on the intake form. */
export const IntakeAllergy = z.object({
  substance: z.string().min(1),
  reaction: z.string().optional(),
  citation: Citation,
  confidence,
});
export type IntakeAllergy = z.infer<typeof IntakeAllergy>;

/** A family-history entry listed on the intake form. */
export const IntakeFamilyHistory = z.object({
  condition: z.string().min(1),
  relation: z.string().optional(),
  citation: Citation,
  confidence,
});
export type IntakeFamilyHistory = z.infer<typeof IntakeFamilyHistory>;

/** Demographics from the intake form — all fields optional (absence-aware). */
export const IntakeDemographics = z.object({
  name: z.string().optional(),
  dob: z.string().optional(),
  sex: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
});
export type IntakeDemographics = z.infer<typeof IntakeDemographics>;

/** The canonical contract for an `intake_form` extraction. Raw VLM output is parsed against this. */
export const IntakeFormExtraction = z.object({
  docType: z.literal("intake_form"),
  // Absence-aware: an omitted demographics block degrades to {} rather than failing the
  // whole-document parse (a scan may have no legible demographics).
  demographics: IntakeDemographics.default({}),
  chiefConcern: z.string().optional(),
  currentMedications: z.array(IntakeMedication),
  allergies: z.array(IntakeAllergy),
  familyHistory: z.array(IntakeFamilyHistory),
  citation: Citation,
});
export type IntakeFormExtraction = z.infer<typeof IntakeFormExtraction>;
