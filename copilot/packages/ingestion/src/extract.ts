import { z } from "zod";
import { LabPdfExtraction } from "./schemas/labPdf.js";
import { IntakeFormExtraction } from "./schemas/intakeForm.js";
import { MedicationListExtraction } from "./schemas/medicationList.js";
import { ReferralFaxExtraction } from "./schemas/referralFax.js";

/** The document types this engine can extract. Matches the canonical schema `docType` literals. */
export type DocType = "lab_pdf" | "intake_form" | "medication_list" | "referral_fax";

/** Raster media types a VLM can read. */
export type ImageMediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

/** One page image handed to the VLM. `page` is 1-based; `base64` is the raw image data. */
export interface PageImage {
  readonly page: number;
  readonly mediaType: ImageMediaType;
  readonly base64: string;
}

/**
 * What the injected VLM port receives. `feedback` is present ONLY on a retry attempt —
 * the flattened schema-violation text from the previous attempt, so the model can correct
 * its output (bounded regenerate-with-feedback, `w2-document-ingestion-writes`).
 */
export interface VlmExtractRequest {
  readonly docType: DocType;
  readonly pages: readonly PageImage[];
  readonly feedback?: string;
}

/**
 * The one boundary this engine calls out through (the "VLM role"). Returns the model's
 * output **already JSON-parsed** into `unknown` (an object) — NOT validated. Validation is
 * the engine's job (parse, don't validate downstream). Transport concerns — timeout,
 * network retry — belong to the port/adapter, not here; a port that rejects propagates.
 */
export type VlmExtractPort = (request: VlmExtractRequest) => Promise<unknown>;

export interface ExtractOptions {
  /** Total attempts (schema-conformance retries included). Default 2 = one retry. */
  readonly maxAttempts?: number;
}

/**
 * The outcome of an extraction. A discriminated union so an unvalidated value is
 * unrepresentable: `degraded` carries no `extraction`, only the flagged field paths.
 */
export type ExtractionOutcome<T> =
  | { readonly status: "ok"; readonly extraction: T; readonly attempts: number }
  | { readonly status: "degraded"; readonly issues: readonly string[]; readonly attempts: number };

const DEFAULT_MAX_ATTEMPTS = 2;

/** Render a ZodError as human/model-readable `path: message` lines for retry feedback. */
function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => {
    const path = i.path.length > 0 ? i.path.join(".") : "(root)";
    return `${path}: ${i.message}`;
  });
}

/**
 * Extract a document's page images into a schema-valid object, or a typed `degraded`
 * outcome. Raw VLM output NEVER bypasses the canonical schema (`w2-document-ingestion-
 * writes`): each attempt is `parse`d; a failure feeds the schema issues back to the port
 * for a bounded retry; when attempts are exhausted it degrades with the offending fields
 * flagged — never a throw on bad output, never a partial/coerced extraction.
 *
 * A port that itself rejects (transport error) propagates unchanged — the engine handles
 * only schema-conformance, not transport.
 */
async function extractDocument<T>(
  // Input type param is `unknown`: we feed raw, unvalidated VLM output in. A schema whose
  // parsed *output* differs from its input (e.g. a `.default()`) still binds here — a bare
  // `z.ZodType<T>` would reject it (its input defaults to `T`).
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  docType: DocType,
  port: VlmExtractPort,
  pages: readonly PageImage[],
  options?: ExtractOptions,
): Promise<ExtractionOutcome<T>> {
  // Coerce to a sane positive integer: a NaN/fractional/≤0 `maxAttempts` must never make the
  // loop skip entirely, which would "degrade" with zero model calls and no flagged issues — a
  // silent drop the schema-canonical rule forbids.
  const requested = options?.maxAttempts;
  const maxAttempts =
    typeof requested === "number" && Number.isFinite(requested)
      ? Math.max(1, Math.floor(requested))
      : DEFAULT_MAX_ATTEMPTS;
  let feedback: string | undefined;
  let lastIssues: string[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const request: VlmExtractRequest =
      feedback === undefined ? { docType, pages } : { docType, pages, feedback };
    const raw = await port(request);

    const result = schema.safeParse(raw);
    if (result.success) {
      return { status: "ok", extraction: result.data, attempts: attempt };
    }

    lastIssues = formatIssues(result.error);
    feedback = [
      "Your previous output did not conform to the required schema. Fix exactly these",
      "problems and return the full document again — do not invent values to fill gaps:",
      ...lastIssues.map((i) => `- ${i}`),
    ].join("\n");
  }

  return { status: "degraded", issues: lastIssues, attempts: maxAttempts };
}

/** Extract a `lab_pdf` document. See {@link extractDocument}. */
export function extractLabPdf(
  port: VlmExtractPort,
  pages: readonly PageImage[],
  options?: ExtractOptions,
): Promise<ExtractionOutcome<LabPdfExtraction>> {
  return extractDocument(LabPdfExtraction, "lab_pdf", port, pages, options);
}

/** Extract an `intake_form` document. See {@link extractDocument}. */
export function extractIntakeForm(
  port: VlmExtractPort,
  pages: readonly PageImage[],
  options?: ExtractOptions,
): Promise<ExtractionOutcome<IntakeFormExtraction>> {
  return extractDocument(IntakeFormExtraction, "intake_form", port, pages, options);
}

/** Extract a `medication_list` document (pharmacy printout / med reconciliation). See {@link extractDocument}. */
export function extractMedicationList(
  port: VlmExtractPort,
  pages: readonly PageImage[],
  options?: ExtractOptions,
): Promise<ExtractionOutcome<MedicationListExtraction>> {
  return extractDocument(MedicationListExtraction, "medication_list", port, pages, options);
}

/** Extract a `referral_fax` document (referral / consult-request fax). See {@link extractDocument}. */
export function extractReferralFax(
  port: VlmExtractPort,
  pages: readonly PageImage[],
  options?: ExtractOptions,
): Promise<ExtractionOutcome<ReferralFaxExtraction>> {
  return extractDocument(ReferralFaxExtraction, "referral_fax", port, pages, options);
}
