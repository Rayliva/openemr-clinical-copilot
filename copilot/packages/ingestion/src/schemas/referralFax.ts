import { z } from "zod";
import { Citation } from "../citation.js";

/** Per-field confidence in [0,1] — drives physician-review attention (low-confidence forced up). */
const confidence = z.number().min(0).max(1);

/**
 * One cited field on a referral fax. Unlike intake demographics (which synthesize a citation), a
 * referral value is a real extracted fact, so it carries its OWN citation + confidence. Present-only:
 * an absent field is omitted from the extraction (absence ≠ empty), never a blank cited value.
 */
export const ReferralField = z.object({
  value: z.string().min(1),
  citation: Citation,
  confidence,
});
export type ReferralField = z.infer<typeof ReferralField>;

/**
 * The canonical contract for a `referral_fax` extraction — the fourth document type (a referral /
 * consult-request fax the front desk uploads before a specialist follow-up). Header fields, each
 * optional + individually cited. Raw VLM output is parsed against this (never bypasses it).
 */
export const ReferralFaxExtraction = z.object({
  docType: z.literal("referral_fax"),
  referralDate: ReferralField.optional(),
  referringProvider: ReferralField.optional(),
  referredTo: ReferralField.optional(),
  reason: ReferralField.optional(),
  diagnosis: ReferralField.optional(),
  citation: Citation,
});
export type ReferralFaxExtraction = z.infer<typeof ReferralFaxExtraction>;
