import {
  classifyDocType,
  detectPendingDocuments,
  ingestIntakeDocument,
  ingestLabDocument,
  ingestMedicationListDocument,
  ingestReferralFaxDocument,
  rasterizePages,
  type DocType,
  type LabIngestionDeps,
  type LabIngestionDraft,
  type PendingDocument,
} from "@copilot/ingestion";
import type { MetricsRegistry } from "@copilot/metrics";
import type { OpenEmrFhirClient } from "@copilot/openemr-client";
import { createClaudeVlm } from "../anthropic/claudeVlm.js";
import { createTesseractOcr } from "../ocr/tesseractOcr.js";
import { createPdfRasterizer } from "../pdf/pdfRasterize.js";
import { loadOpenEmrFhirClient } from "../openemr/loadClient.js";
import {
  createRedisDraftCache,
  type DraftCache,
  type IngestionStatus,
  type PersistedExtraction,
  type RedisLike,
} from "./draftCache.js";

/** The draft without its (regenerable) page image — the record persisted for VLM-free re-opens. */
function extractionOf(draft: LabIngestionDraft): PersistedExtraction {
  const { pages: _pages, ...rest } = draft;
  return rest;
}

/**
 * Dispatch a detected document to its type-specific ingestion pipeline. Exhaustive `switch` (no
 * `default`) so adding a fourth `DocType` is a compile error here until it is handled — every type
 * shares the same deps + `LabIngestionDraft` shape, so only the extraction schema + box-match differ.
 */
function ingestByType(
  docType: DocType,
  doc: PendingDocument,
  deps: LabIngestionDeps,
): Promise<LabIngestionDraft> {
  switch (docType) {
    case "intake_form":
      return ingestIntakeDocument(doc, deps);
    case "medication_list":
      return ingestMedicationListDocument(doc, deps);
    case "referral_fax":
      return ingestReferralFaxDocument(doc, deps);
    case "lab_pdf":
      return ingestLabDocument(doc, deps);
  }
}

/**
 * The edge that runs Week-2 document ingestion for a patient: list the patient's
 * `DocumentReference`s over FHIR, detect the un-ingested PDFs, and ingest each into a
 * pending-review draft — **cached** so a document is extracted once and the review modal opens
 * instantly. Read-only (proposes drafts, never writes the chart, `w2-document-ingestion-writes`).
 * The bound patient FHIR id comes from the caller's verified session token
 * (`authorization-and-pid-scope`), never a request argument.
 */
/**
 * A minimal PHI-free structured logger (pino's `Logger` satisfies it). W2 ingestion events
 * (`ingestion.complete`, `extraction.field`) are emitted through it with object context only —
 * never string interpolation, never a title or value (`error-handling-and-logging`, `phi-and-secrets`).
 */
export interface IngestionLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

/**
 * Per-request observability threaded into an ingestion run. `metrics` is service-level (the live
 * window); `logger` + `correlationId` are per-request so each W2 event can carry the correlation id.
 * All optional — an unobserved run (tests, no metrics wired) behaves exactly as before.
 */
export interface IngestionObservability {
  readonly metrics?: MetricsRegistry;
  readonly logger?: IngestionLogger;
  readonly correlationId?: string;
}

/** Round to two decimals (a confidence like 0.7967 → 0.8), keeping logs terse + stable. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Numeric per-document extraction confidence — the model's own per-field `confidence` (0–1)
 * aggregated to `{confidenceMin, confidenceMean(2dp), fields}` for the per-encounter log
 * (Core Req 7). `null` when the draft is degraded or carries no results (nothing to score).
 * PHI-free: a confidence number + a field count, never a value or title. Structural param so it
 * is trivially testable and accepts any draft shape carrying `results[].result.confidence`.
 */
export function draftConfidence(draft: {
  readonly status: string;
  readonly results?: readonly { readonly result: { readonly confidence: number } }[];
}): { readonly confidenceMin: number; readonly confidenceMean: number; readonly fields: number } | null {
  if (draft.status !== "ok" || draft.results === undefined || draft.results.length === 0) {
    return null;
  }
  const confidences = draft.results.map((r) => r.result.confidence);
  const sum = confidences.reduce((total, c) => total + c, 0);
  return {
    confidenceMin: round2(Math.min(...confidences)),
    confidenceMean: round2(sum / confidences.length),
    fields: confidences.length,
  };
}

/** Per-document box-match tally derived from a draft — the located-vs-forced-review split. */
function draftFieldCounts(draft: LabIngestionDraft): { located: number; forcedReview: number } {
  if (draft.status !== "ok") {
    return { located: 0, forcedReview: 0 };
  }
  let located = 0;
  let forcedReview = 0;
  for (const r of draft.results) {
    if (r.match.state === "located") {
      located += 1;
    } else {
      forcedReview += 1;
    }
  }
  return { located, forcedReview };
}

export interface IngestionService {
  /**
   * Detect + ingest the bound patient's pending documents into review drafts (cache-aware).
   * `correlationId` (from the verified session token) threads W2 structured-log events; the
   * per-request `logger` carries them (metrics are service-level).
   */
  detectAndIngest(
    patientFhirId: string,
    obs?: {
      readonly correlationId?: string;
      readonly logger?: IngestionLogger;
      /** Restrict extraction to these document ids (the modal passes the un-reviewed ones). */
      readonly onlyDocumentIds?: readonly string[];
    },
  ): Promise<readonly LabIngestionDraft[]>;
  /** Cheap detect-only status for the notification dot — NO VLM call. */
  status(patientFhirId: string): Promise<IngestionStatus>;
}

/** Read a patient's DocumentReference bundle and detect the pending PDFs (pure over the client). */
async function detectPending(
  fhir: Pick<OpenEmrFhirClient, "search">,
  patientFhirId: string,
): Promise<ReturnType<typeof detectPendingDocuments>> {
  const bundle = await fhir.search("DocumentReference", { patient: patientFhirId });
  return detectPendingDocuments(bundle, new Set());
}

/**
 * The testable core: for each pending doc, return the cached draft on a hit; otherwise claim the
 * per-doc lock and extract exactly once (double-checking the cache after the claim). A doc whose lock
 * is already held by a concurrent extraction is skipped — the caller (modal) polls {@link statusOf}
 * and re-fetches. Injected `fhir` / `deps` / `cache` so it runs offline with stubs.
 */
export async function runDetectAndIngest(
  fhir: Pick<OpenEmrFhirClient, "search" | "readBinary">,
  deps: LabIngestionDeps,
  cache: DraftCache,
  patientFhirId: string,
  obs: IngestionObservability = {},
  onlyDocumentIds?: readonly string[],
): Promise<readonly LabIngestionDraft[]> {
  const detected = await detectPending(fhir, patientFhirId);
  // Scope to the requested documents (the review modal asks only for the UN-reviewed ones, so a
  // patient with 100 documents doesn't extract all 100). Absent → every detected document.
  const pending = onlyDocumentIds !== undefined
    ? detected.filter((doc) => onlyDocumentIds.includes(doc.documentId))
    : detected;
  const drafts: LabIngestionDraft[] = [];
  // Only documents actually extracted this run are observed (a cache hit records nothing —
  // extract-once). Tallied for the closing `ingestion.complete` event.
  let extractedCount = 0;
  let okCount = 0;
  let degradedCount = 0;

  for (const doc of pending) {
    const cached = await cache.get(doc.documentId);
    if (cached !== null) {
      drafts.push(cached);
      continue;
    }

    // VLM-free re-open: the extraction result survived (long TTL) though the full draft (short TTL,
    // holds the image) expired → regenerate just the page image and reattach it. The paid VLM never
    // re-runs; the large image is re-derived on demand rather than kept at rest.
    const persisted = await cache.getExtraction(doc.documentId);
    if (persisted !== null) {
      try {
        const pages = await rasterizePages(doc, deps);
        const draft: LabIngestionDraft = { ...persisted, pages };
        await cache.set(doc.documentId, draft);
        drafts.push(draft);
        continue;
      } catch {
        // Re-rasterizing a persisted extraction failed (rare) → fall through to a full re-extract.
      }
    }

    const acquired = await cache.acquireLock(doc.documentId);
    if (!acquired) {
      continue; // another extraction is in flight — surfaced via status(), re-fetched on poll
    }
    try {
      // A concurrent extraction may have finished between the miss and the lock — re-check.
      const recheck = await cache.get(doc.documentId);
      if (recheck !== null) {
        drafts.push(recheck);
        continue;
      }
      // Route by document type — every W2 type shares the same deps + draft shape, so the review
      // UI + cache are unchanged; only the extraction schema + box-match differ.
      const docType = classifyDocType(doc);
      const startedAt = performance.now();
      const draft = await ingestByType(docType, doc, deps);
      const latencyMs = performance.now() - startedAt;
      // Persist the extraction result (no image, long TTL) so the paid VLM never re-runs, plus the
      // full draft (with image, short TTL) for the instant re-open path.
      await cache.setExtraction(doc.documentId, extractionOf(draft));
      await cache.set(doc.documentId, draft);
      drafts.push(draft);

      // W2 signals — recorded only on a real extraction. Counts/types/states only (no title,
      // no value): the located-vs-forced-review split and the extract-to-draft latency.
      const { located, forcedReview } = draftFieldCounts(draft);
      const confidence = draftConfidence(draft);
      extractedCount += 1;
      if (draft.status === "ok") {
        okCount += 1;
      } else {
        degradedCount += 1;
      }
      obs.metrics?.recordIngestion({
        docType,
        outcome: draft.status,
        fieldsLocated: located,
        fieldsForcedReview: forcedReview,
        latencyMs,
      });
      obs.logger?.info(
        {
          correlationId: obs.correlationId,
          docType,
          outcome: draft.status,
          located,
          forcedReview,
          // Numeric model confidence for this document (Core Req 7). PHI-free — numbers only.
          ...(confidence !== null
            ? {
                confidenceMin: confidence.confidenceMin,
                confidenceMean: confidence.confidenceMean,
                fields: confidence.fields,
              }
            : {}),
        },
        "extraction.field",
      );
    } finally {
      await cache.releaseLock(doc.documentId);
    }
  }

  if (extractedCount > 0) {
    obs.logger?.info(
      { correlationId: obs.correlationId, documents: extractedCount, ok: okCount, degraded: degradedCount },
      "ingestion.complete",
    );
  }
  return drafts;
}

/**
 * Detect-only status (no VLM): total pending, how many are cached-ready, how many extracting.
 * Cached per pid for a short window so a chart-open dot poll does not re-hit the (audit-amplified)
 * DocumentReference search every time.
 */
export async function statusOf(
  fhir: Pick<OpenEmrFhirClient, "search">,
  cache: DraftCache,
  patientFhirId: string,
): Promise<IngestionStatus> {
  const cached = await cache.getStatus(patientFhirId);
  if (cached !== null) {
    return cached;
  }
  const pending = await detectPending(fhir, patientFhirId);
  let ready = 0;
  let extracting = 0;
  for (const doc of pending) {
    if ((await cache.get(doc.documentId)) !== null) {
      ready += 1;
    } else if (await cache.isLocked(doc.documentId)) {
      extracting += 1;
    }
  }
  const status: IngestionStatus = {
    total: pending.length,
    ready,
    extracting,
    documentIds: pending.map((doc) => doc.documentId),
  };
  await cache.setStatus(patientFhirId, status);
  return status;
}

export interface IngestionServiceOptions {
  readonly copilotRoot: string;
  readonly openemrBaseUrl: string;
  readonly openemrFetch: (url: string, init?: RequestInit) => Promise<Response>;
  /** Anthropic key + vision model for the VLM extraction (Opus-class per the model-tiering decision). */
  readonly anthropicApiKey: string;
  readonly vlmModel: string;
  /** The agent's own (in-boundary) Redis, for the draft cache + in-flight lock. */
  readonly redis: RedisLike;
  /** Draft TTL in seconds — hours, not days (default 6h). */
  readonly draftTtlSeconds?: number;
  /** Optional live operational metrics window; W2 ingestion signals are recorded to it. */
  readonly metrics?: MetricsRegistry;
}

const DEFAULT_DRAFT_TTL = 6 * 60 * 60;

/**
 * Build the live {@link IngestionService} from `.secrets` + the injected engines + Redis cache.
 * Returns `null` when the OpenEMR client isn't registered or the Anthropic key is absent, so the
 * caller simply does not expose the ingestion routes (fail-closed, like `/chat`).
 */
export async function buildIngestionService(
  options: IngestionServiceOptions,
): Promise<IngestionService | null> {
  if (options.anthropicApiKey.length === 0) {
    return null;
  }
  const fhir = await loadOpenEmrFhirClient(options);
  if (fhir === null) {
    return null;
  }

  const deps: LabIngestionDeps = {
    fetchBinary: (binaryId) => fhir.readBinary(binaryId),
    rasterize: createPdfRasterizer(),
    vlm: createClaudeVlm({ apiKey: options.anthropicApiKey, model: options.vlmModel }),
    ocr: createTesseractOcr(),
  };
  const cache = createRedisDraftCache(options.redis, {
    ttlSeconds: options.draftTtlSeconds ?? DEFAULT_DRAFT_TTL,
  });

  return {
    detectAndIngest: (patientFhirId, reqObs) =>
      runDetectAndIngest(
        fhir,
        deps,
        cache,
        patientFhirId,
        {
          ...(options.metrics !== undefined ? { metrics: options.metrics } : {}),
          ...(reqObs?.logger !== undefined ? { logger: reqObs.logger } : {}),
          ...(reqObs?.correlationId !== undefined ? { correlationId: reqObs.correlationId } : {}),
        },
        reqObs?.onlyDocumentIds,
      ),
    status: (patientFhirId) => statusOf(fhir, cache, patientFhirId),
  };
}
