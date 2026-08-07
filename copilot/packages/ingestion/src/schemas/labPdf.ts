import { z } from "zod";
import { Citation } from "../citation.js";

/** Lab abnormal-flag, a closed set (enum, per the exhaustive-matching convention). */
export const AbnormalFlag = z.enum(["normal", "high", "low", "critical", "abnormal", "unknown"]);
export type AbnormalFlag = z.infer<typeof AbnormalFlag>;

/**
 * One extracted lab result. `value` stays a **string** — clinical values are not always numeric
 * (`"<5.7"`, `"Negative"`) and coercion would hide bad data. Absence-aware: unit / referenceRange /
 * collectionDate may be absent on an imperfect scan. Every result carries a citation + confidence.
 */
export const LabResult = z.object({
  testName: z.string().min(1),
  value: z.string(),
  unit: z.string().optional(),
  referenceRange: z.string().optional(),
  collectionDate: z.string().optional(),
  abnormalFlag: AbnormalFlag,
  citation: Citation,
  confidence: z.number().min(0).max(1),
});
export type LabResult = z.infer<typeof LabResult>;

/** The canonical contract for a `lab_pdf` extraction. Raw VLM output is parsed against this. */
export const LabPdfExtraction = z.object({
  docType: z.literal("lab_pdf"),
  results: z.array(LabResult),
});
export type LabPdfExtraction = z.infer<typeof LabPdfExtraction>;
