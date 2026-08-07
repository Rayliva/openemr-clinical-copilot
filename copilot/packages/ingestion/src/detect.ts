import { z } from "zod";

/**
 * Pure document detection: parse a FHIR `DocumentReference` search Bundle into the patient's
 * un-ingested source documents. The front desk uploads a PDF via OpenEMR's Documents flow (→ a
 * `DocumentReference` + `Binary`); this surfaces the ones not yet ingested for review
 * (`docs/specs/w2-document-detection.md`, Core Req 1). No IO — the FHIR fetch and the byte download
 * are injected boundaries in a later slice (`orchestrator-only`).
 */

/** Content types the extraction pipeline supports today (both W2 doc types are PDFs). */
const SUPPORTED_CONTENT_TYPES: ReadonlySet<string> = new Set(["application/pdf"]);

/** A source document awaiting ingestion — enough to fetch its bytes and track idempotency. */
export interface PendingDocument {
  /** `DocumentReference.id` (uuid), stable per document — the `alreadyProcessed` key. */
  readonly documentId: string;
  /** The `Binary/<id>` to fetch the document bytes from. */
  readonly binaryId: string;
  /** The attachment MIME type (a supported type, e.g. `application/pdf`). */
  readonly contentType: string;
  /** The document's display name (attachment title), or `""`. */
  readonly title: string;
  /** `DocumentReference.date`, when present. */
  readonly date?: string;
}

/** Lenient shape of the fields we read from one DocumentReference; unknown fields pass through. */
const AttachmentSchema = z
  .object({
    contentType: z.string().optional(),
    url: z.string().optional(),
    title: z.string().optional(),
  })
  .passthrough();

const DocumentReferenceSchema = z
  .object({
    resourceType: z.literal("DocumentReference"),
    id: z.string().min(1),
    status: z.string().optional(),
    date: z.string().optional(),
    content: z
      .array(z.object({ attachment: AttachmentSchema.optional() }).passthrough())
      .optional(),
  })
  .passthrough();

/** The Bundle envelope — only `entry` matters here; a non-object is a corrupt response (throw).
 * Entries are `unknown` so a single malformed entry is skipped per-item, not a batch-dropping throw. */
const BundleSchema = z
  .object({
    entry: z.array(z.unknown()).optional(),
  })
  .passthrough();

const EntrySchema = z.object({ resource: z.unknown() }).passthrough();

/** Parse the `Binary/<id>` id out of an attachment url; null if it is not a Binary reference.
 * Accepts an absolute url (`https://host/.../Binary/<id>`) or a relative FHIR ref (`Binary/<id>`). */
function binaryIdFromUrl(url: string | undefined): string | null {
  if (url === undefined) {
    return null;
  }
  const match = /(?:^|\/)Binary\/([^/?#]+)/.exec(url);
  return match?.[1] ?? null;
}

/** The bare MIME type without any `; charset=…` parameters, lowercased. */
function baseContentType(contentType: string): string {
  return contentType.split(";")[0]?.trim().toLowerCase() ?? "";
}

/**
 * Detect the patient's pending (un-ingested) source documents from a FHIR DocumentReference Bundle.
 *
 * Emits a {@link PendingDocument} per DocumentReference that is `current`, carries a supported-type
 * attachment with a resolvable `Binary/<id>` url, and whose id is not in `alreadyProcessed`. A single
 * malformed entry is skipped (never drops the rest); a non-object bundle throws (a corrupt response is
 * a fail-loud integrity error, not a silent empty list — `w2-document-ingestion-writes`).
 */
export function detectPendingDocuments(
  bundle: unknown,
  alreadyProcessed: ReadonlySet<string>,
): PendingDocument[] {
  const parsed = BundleSchema.parse(bundle);
  const pending: PendingDocument[] = [];

  for (const rawEntry of parsed.entry ?? []) {
    const entryResult = EntrySchema.safeParse(rawEntry);
    if (!entryResult.success) {
      continue; // a non-object / resource-less entry — skip, don't fail the batch
    }
    const docResult = DocumentReferenceSchema.safeParse(entryResult.data.resource);
    if (!docResult.success) {
      continue; // not a DocumentReference / malformed — skip, don't fail the batch
    }
    const doc = docResult.data;

    if (doc.status !== "current") {
      continue; // never re-ingest a superseded / entered-in-error document
    }
    if (alreadyProcessed.has(doc.id)) {
      continue; // already ingested or queued
    }

    for (const content of doc.content ?? []) {
      const attachment = content.attachment;
      const contentType = attachment?.contentType;
      const binaryId = binaryIdFromUrl(attachment?.url);
      if (attachment === undefined || contentType === undefined || binaryId === null) {
        continue;
      }
      if (!SUPPORTED_CONTENT_TYPES.has(baseContentType(contentType))) {
        continue;
      }
      pending.push({
        documentId: doc.id,
        binaryId,
        contentType,
        title: attachment.title ?? "",
        ...(doc.date !== undefined ? { date: doc.date } : {}),
      });
      break; // one PendingDocument per DocumentReference (first supported attachment)
    }
  }

  return pending;
}
