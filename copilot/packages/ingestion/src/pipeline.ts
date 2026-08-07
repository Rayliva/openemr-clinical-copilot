import {
  extractLabPdf,
  extractIntakeForm,
  extractMedicationList,
  extractReferralFax,
  type PageImage,
  type VlmExtractPort,
} from "./extract.js";
import { locateLabResults, type LocatedLabResult, type OcrPage } from "./boxMatch.js";
import { locateIntakeValues } from "./intakeBoxMatch.js";
import { locateMedicationListValues } from "./medicationListBoxMatch.js";
import { locateReferralFaxValues } from "./referralFaxBoxMatch.js";
import type { OcrPort } from "./ocrPort.js";
import type { PdfRasterizePort } from "./rasterize.js";
import type { PendingDocument } from "./detect.js";

/**
 * The lab-ingestion pipeline: a detected pending document → its bytes → page rasters → a
 * schema-valid extraction with OCR-located citations → a **pending-review draft**. Pure
 * orchestration over injected ports (`orchestrator-only`, spec `docs/specs/w2-ingestion-pipeline.md`).
 * NO write — the draft is *proposed* for human review; the module commits it later
 * (`w2-document-ingestion-writes`).
 */

/** Fetch a document's bytes by its `Binary/<id>`. Concrete impl (openemr-client) is the edge. */
export type BinaryFetchPort = (binaryId: string) => Promise<Uint8Array>;

/** The injected boundaries the pipeline runs over — all offline-stubbable. */
export interface LabIngestionDeps {
  readonly fetchBinary: BinaryFetchPort;
  readonly rasterize: PdfRasterizePort;
  readonly vlm: VlmExtractPort;
  readonly ocr: OcrPort;
}

/**
 * A reviewable draft for one document. Discriminated on `status` so an invalid extraction is
 * unrepresentable as "ok". `pages` are carried so the review UI can draw the box overlay without
 * re-rasterizing.
 */
interface DraftBase {
  readonly documentId: string;
  /** The document's display name — carried so the review UI needn't re-thread the PendingDocument. */
  readonly title: string;
  readonly date?: string;
  /** Page rasters, carried so the review UI can draw the box overlay without re-rasterizing. */
  readonly pages: readonly PageImage[];
}

export type LabIngestionDraft =
  | (DraftBase & { readonly status: "ok"; readonly results: readonly LocatedLabResult[] })
  | (DraftBase & { readonly status: "degraded"; readonly issues: readonly string[] });

/**
 * Ingest one lab document into a pending-review draft. Fetch → rasterize → extract (schema-canonical)
 * → OCR box-match. A schema-degrade returns a `degraded` draft (no OCR/locate on an invalid
 * extraction); an OCR that yields no words still returns `ok` with every value forced to review (a
 * dropped OCR box is a forced review, never a dropped citation). Infra failures (fetch / rasterize /
 * VLM transport / OCR) propagate to the caller node, which logs + degrades.
 */
/**
 * Fetch + rasterize a document's page images ONLY — no VLM, no OCR. Used to regenerate the page image
 * for a document whose extraction result is already persisted, so the paid VLM never re-runs (the big
 * image is not kept at rest; it is re-derived on demand).
 */
export async function rasterizePages(
  doc: PendingDocument,
  deps: Pick<LabIngestionDeps, "fetchBinary" | "rasterize">,
): Promise<readonly PageImage[]> {
  const bytes = await deps.fetchBinary(doc.binaryId);
  return deps.rasterize(bytes);
}

export async function ingestLabDocument(
  doc: PendingDocument,
  deps: LabIngestionDeps,
): Promise<LabIngestionDraft> {
  const base = {
    documentId: doc.documentId,
    title: doc.title,
    ...(doc.date !== undefined ? { date: doc.date } : {}),
  };

  const bytes = await deps.fetchBinary(doc.binaryId);
  const pages = await deps.rasterize(bytes);

  // A valid PDF rasterizes to ≥1 page (createPdfRasterizer throws on zero); a rasterizer that still
  // yields none leaves nothing to extract or overlay — degrade for review, never a hollow "ok".
  if (pages.length === 0) {
    return { ...base, status: "degraded", pages, issues: ["document rasterized to zero pages"] };
  }

  const outcome = await extractLabPdf(deps.vlm, pages);
  if (outcome.status === "degraded") {
    return { ...base, status: "degraded", pages, issues: outcome.issues };
  }

  const ocrPage: OcrPage = await deps.ocr({ pages });
  const located = locateLabResults(outcome.extraction, ocrPage);
  return { ...base, status: "ok", pages, results: located.results };
}

/**
 * Ingest one **intake-form** document into a pending-review draft — the second document type. Mirrors
 * {@link ingestLabDocument} exactly (same `deps`, same `LabIngestionDraft`): fetch → rasterize →
 * `extractIntakeForm` (schema-canonical; degrade on schema failure or zero pages) → OCR box-match via
 * `locateIntakeValues`, which flattens the intake extraction into the SAME `LocatedLabResult[]` shape
 * so the existing review UI renders it unchanged. A dropped OCR box is a forced review, never a dropped
 * citation. Infra failures (fetch / rasterize / VLM transport / OCR) propagate to the caller node.
 *
 * Spec: `docs/specs/w2-intake-ingestion-pipeline.md`.
 */
export async function ingestIntakeDocument(
  doc: PendingDocument,
  deps: LabIngestionDeps,
): Promise<LabIngestionDraft> {
  const base = {
    documentId: doc.documentId,
    title: doc.title,
    ...(doc.date !== undefined ? { date: doc.date } : {}),
  };

  const bytes = await deps.fetchBinary(doc.binaryId);
  const pages = await deps.rasterize(bytes);

  if (pages.length === 0) {
    return { ...base, status: "degraded", pages, issues: ["document rasterized to zero pages"] };
  }

  const outcome = await extractIntakeForm(deps.vlm, pages);
  if (outcome.status === "degraded") {
    return { ...base, status: "degraded", pages, issues: outcome.issues };
  }

  const ocrPage: OcrPage = await deps.ocr({ pages });
  const located = locateIntakeValues(outcome.extraction, ocrPage);
  return { ...base, status: "ok", pages, results: located.results };
}

/**
 * Ingest one **medication-list** document into a pending-review draft — the third document type (a
 * pharmacy printout / med-reconciliation list). Mirrors {@link ingestIntakeDocument} exactly (same
 * `deps`, same `LabIngestionDraft`): fetch → rasterize → `extractMedicationList` (schema-canonical;
 * degrade on schema failure or zero pages) → OCR box-match via `locateMedicationListValues`, which
 * flattens the medications into the SAME `LocatedLabResult[]` shape so the review UI + write path are
 * unchanged. A dropped OCR box is a forced review, never a dropped citation. Infra failures propagate.
 *
 * Spec: `docs/specs/w2-medication-list-ingestion.md`.
 */
export async function ingestMedicationListDocument(
  doc: PendingDocument,
  deps: LabIngestionDeps,
): Promise<LabIngestionDraft> {
  const base = {
    documentId: doc.documentId,
    title: doc.title,
    ...(doc.date !== undefined ? { date: doc.date } : {}),
  };

  const bytes = await deps.fetchBinary(doc.binaryId);
  const pages = await deps.rasterize(bytes);

  if (pages.length === 0) {
    return { ...base, status: "degraded", pages, issues: ["document rasterized to zero pages"] };
  }

  const outcome = await extractMedicationList(deps.vlm, pages);
  if (outcome.status === "degraded") {
    return { ...base, status: "degraded", pages, issues: outcome.issues };
  }

  const ocrPage: OcrPage = await deps.ocr({ pages });
  const located = locateMedicationListValues(outcome.extraction, ocrPage);
  return { ...base, status: "ok", pages, results: located.results };
}

/**
 * Ingest one **referral-fax** document into a pending-review draft — the fourth document type (a
 * referral / consult-request fax). Mirrors {@link ingestMedicationListDocument} exactly (same `deps`,
 * same `LabIngestionDraft`): fetch → rasterize → `extractReferralFax` (schema-canonical; degrade on
 * schema failure or zero pages) → OCR box-match via `locateReferralFaxValues`, which flattens the
 * referral fields into the SAME `LocatedLabResult[]` shape so the review UI + write path are unchanged.
 * A dropped OCR box is a forced review, never a dropped citation. Infra failures propagate.
 *
 * Spec: `docs/specs/w2-referral-fax-ingestion.md`.
 */
export async function ingestReferralFaxDocument(
  doc: PendingDocument,
  deps: LabIngestionDeps,
): Promise<LabIngestionDraft> {
  const base = {
    documentId: doc.documentId,
    title: doc.title,
    ...(doc.date !== undefined ? { date: doc.date } : {}),
  };

  const bytes = await deps.fetchBinary(doc.binaryId);
  const pages = await deps.rasterize(bytes);

  if (pages.length === 0) {
    return { ...base, status: "degraded", pages, issues: ["document rasterized to zero pages"] };
  }

  const outcome = await extractReferralFax(deps.vlm, pages);
  if (outcome.status === "degraded") {
    return { ...base, status: "degraded", pages, issues: outcome.issues };
  }

  const ocrPage: OcrPage = await deps.ocr({ pages });
  const located = locateReferralFaxValues(outcome.extraction, ocrPage);
  return { ...base, status: "ok", pages, results: located.results };
}
