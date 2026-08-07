export { Citation, BoundingBox, CitationSourceType } from "./citation.js";
export { LabPdfExtraction, LabResult, AbnormalFlag } from "./schemas/labPdf.js";
export {
  IntakeFormExtraction,
  IntakeMedication,
  IntakeAllergy,
  IntakeFamilyHistory,
  IntakeDemographics,
} from "./schemas/intakeForm.js";
export { MedicationListExtraction, MedicationListItem } from "./schemas/medicationList.js";
export { ReferralFaxExtraction, ReferralField } from "./schemas/referralFax.js";
export {
  extractLabPdf,
  extractIntakeForm,
  extractMedicationList,
  extractReferralFax,
  type DocType,
  type ImageMediaType,
  type PageImage,
  type VlmExtractRequest,
  type VlmExtractPort,
  type ExtractOptions,
  type ExtractionOutcome,
} from "./extract.js";
export {
  locateValue,
  locateLabResults,
  type OcrWord,
  type OcrPage,
  type MatchState,
  type LocateResult,
  type LocatedLabResult,
  type LocatedLabExtraction,
} from "./boxMatch.js";
export { parseOcrMap, parseOcrPage } from "./ocrMap.js";
export { fromOcrMap, type OcrRequest, type OcrPort } from "./ocrPort.js";
export { normalizeOcrWords, type RawOcrWord } from "./ocrNormalize.js";
export { type PdfRasterizePort } from "./rasterize.js";
export { detectPendingDocuments, type PendingDocument } from "./detect.js";
export { classifyDocType } from "./classify.js";
export { locateIntakeValues } from "./intakeBoxMatch.js";
export { locateMedicationListValues } from "./medicationListBoxMatch.js";
export { locateReferralFaxValues } from "./referralFaxBoxMatch.js";
export {
  ingestLabDocument,
  ingestIntakeDocument,
  ingestMedicationListDocument,
  ingestReferralFaxDocument,
  rasterizePages,
  type BinaryFetchPort,
  type LabIngestionDeps,
  type LabIngestionDraft,
} from "./pipeline.js";
