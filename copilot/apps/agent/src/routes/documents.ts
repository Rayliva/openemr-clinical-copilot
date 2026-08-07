import type { FastifyPluginAsync } from "fastify";
import { verifySessionToken, isSystemIngestToken } from "@copilot/session-token";
import type { LabIngestionDraft } from "@copilot/ingestion";
import type { IngestionService } from "../ingestion/ingestionService.js";
import { resolveCorsOrigin, extractBearerToken } from "./chat.js";

/**
 * `POST /documents/pending` — run Week-2 document ingestion for the bound patient and return the
 * review drafts (extracted values + confidence + bounding boxes + page image for the overlay). The
 * patient is fixed by the verified session token (`authorization-and-pid-scope`); the body carries
 * nothing patient-selecting. Read-only: it proposes drafts, it never writes the chart.
 */
export interface DocumentsRouteOptions {
  readonly bridgeSecret: string;
  readonly allowedOrigin?: string;
  readonly now?: () => number;
}

/** One reviewable field in the JSON response (a lab result + its box-match outcome). */
interface ReviewResult {
  readonly testName: string;
  readonly value: string;
  readonly unit?: string;
  readonly referenceRange?: string;
  readonly abnormalFlag: string;
  readonly confidence: number;
  readonly matchState: string;
  readonly box?: { readonly page: number; readonly x: number; readonly y: number; readonly w: number; readonly h: number };
}

interface ReviewDraft {
  readonly documentId: string;
  readonly title: string;
  readonly date?: string;
  readonly status: "ok" | "degraded";
  readonly pageImageBase64?: string;
  readonly pageMediaType?: string;
  readonly results?: readonly ReviewResult[];
  readonly issues?: readonly string[];
}

/** Shape a draft for the review UI: values + boxes + the first page image for the overlay. */
function toReviewDraft(draft: LabIngestionDraft): ReviewDraft {
  const firstPage = draft.pages[0];
  const base = {
    documentId: draft.documentId,
    title: draft.title,
    ...(draft.date !== undefined ? { date: draft.date } : {}),
    ...(firstPage !== undefined
      ? { pageImageBase64: firstPage.base64, pageMediaType: firstPage.mediaType }
      : {}),
  };
  if (draft.status === "degraded") {
    return { ...base, status: "degraded", issues: draft.issues };
  }
  return {
    ...base,
    status: "ok",
    results: draft.results.map((r): ReviewResult => ({
      testName: r.result.testName,
      value: r.result.value,
      ...(r.result.unit !== undefined ? { unit: r.result.unit } : {}),
      ...(r.result.referenceRange !== undefined ? { referenceRange: r.result.referenceRange } : {}),
      abnormalFlag: r.result.abnormalFlag,
      confidence: r.result.confidence,
      matchState: r.match.state,
      ...(r.result.citation.locator !== undefined ? { box: r.result.citation.locator } : {}),
    })),
  };
}

const defaultNow = (): number => Math.floor(Date.now() / 1000);

export function documentsRoutes(
  service: IngestionService,
  options: DocumentsRouteOptions,
): FastifyPluginAsync {
  const now = options.now ?? defaultNow;

  return async (app) => {
    app.options("/documents/pending", async (request, reply) => {
      const origin = resolveCorsOrigin(request.headers.origin, options.allowedOrigin);
      if (origin !== null) {
        reply
          .header("access-control-allow-origin", origin)
          .header("vary", "origin")
          .header("access-control-allow-methods", "POST, OPTIONS")
          .header("access-control-allow-headers", "authorization, content-type");
      }
      reply.code(204);
      return reply.send();
    });

    // Cheap detect-only status for the notification dot — NO VLM call, so it is safe to poll on
    // chart-open. Token-bound like /pending; the patient comes from the signed token.
    app.options("/documents/status", async (request, reply) => {
      const origin = resolveCorsOrigin(request.headers.origin, options.allowedOrigin);
      if (origin !== null) {
        reply
          .header("access-control-allow-origin", origin)
          .header("vary", "origin")
          .header("access-control-allow-methods", "GET, OPTIONS")
          .header("access-control-allow-headers", "authorization, content-type");
      }
      reply.code(204);
      return reply.send();
    });

    app.get("/documents/status", async (request, reply) => {
      const corsOrigin = resolveCorsOrigin(request.headers.origin, options.allowedOrigin);
      if (corsOrigin !== null) {
        reply.header("access-control-allow-origin", corsOrigin).header("vary", "origin");
      }
      const token = extractBearerToken(request.headers.authorization);
      if (token === null) {
        reply.code(401);
        return reply.send({ error: "missing bearer token" });
      }
      const verified = verifySessionToken(token, options.bridgeSecret, now());
      if (!verified.ok) {
        reply.code(401);
        return reply.send({ error: "invalid or expired token" });
      }
      // A confined system-ingest token may ONLY hit /documents/extract — never a read path.
      if (isSystemIngestToken(verified.payload)) {
        reply.code(403);
        return reply.send({ error: "not permitted for this token" });
      }
      try {
        const status = await service.status(verified.payload.patientFhirId);
        return reply.send(status);
      } catch (error) {
        app.log.error({ correlationId: verified.payload.correlationId, err: error }, "documents: status failed");
        reply.code(502);
        return reply.send({ error: "document status failed" });
      }
    });

    app.post("/documents/pending", async (request, reply) => {
      const corsOrigin = resolveCorsOrigin(request.headers.origin, options.allowedOrigin);
      if (corsOrigin !== null) {
        reply.header("access-control-allow-origin", corsOrigin).header("vary", "origin");
      }

      const token = extractBearerToken(request.headers.authorization);
      if (token === null) {
        reply.code(401);
        return reply.send({ error: "missing bearer token" });
      }
      const verified = verifySessionToken(token, options.bridgeSecret, now());
      if (!verified.ok) {
        app.log.warn({ correlationId: String(request.id), reason: verified.reason }, "documents: token rejected");
        reply.code(401);
        return reply.send({ error: "invalid or expired token" });
      }
      // The review modal is a user surface; a confined system-ingest token must not read drafts here.
      if (isSystemIngestToken(verified.payload)) {
        reply.code(403);
        return reply.send({ error: "not permitted for this token" });
      }

      const { patientFhirId, correlationId } = verified.payload;
      // Optional filter: extract only these document ids (the modal sends the UN-reviewed ones so a
      // 100-document patient doesn't extract all 100). Absent → every detected document.
      let onlyDocumentIds: readonly string[] | undefined;
      const body: unknown = request.body;
      if (body !== null && typeof body === "object" && "documentIds" in body) {
        const ids = (body as { documentIds?: unknown }).documentIds;
        if (Array.isArray(ids)) {
          onlyDocumentIds = ids.filter((id): id is string => typeof id === "string");
        }
      }
      try {
        const drafts = await service.detectAndIngest(patientFhirId, {
          correlationId,
          logger: app.log,
          ...(onlyDocumentIds !== undefined ? { onlyDocumentIds } : {}),
        });
        reply.header("x-correlation-id", correlationId);
        return reply.send({ documents: drafts.map(toReviewDraft) });
      } catch (error) {
        // Boundary catch: log the detail (PHI-free — ingestion errors are typed message-only),
        // return a generic message. Never surface internals to the UI.
        app.log.error({ correlationId, err: error }, "documents: ingestion failed");
        reply.code(502);
        return reply.send({ error: "document ingestion failed" });
      }
    });

    // Server-to-server upload trigger: extract + cache the patient's pending docs. NO CORS (never
    // browser-reachable) and accepts ONLY a confined `system:ingest` token, so a leaked/forged user
    // token cannot reach it and this token cannot reach a read path. Returns 202 immediately and
    // extracts in the background — the PHP listener fires it fire-and-forget so the upload never waits.
    app.post("/documents/extract", async (request, reply) => {
      const token = extractBearerToken(request.headers.authorization);
      if (token === null) {
        reply.code(401);
        return reply.send({ error: "missing bearer token" });
      }
      const verified = verifySessionToken(token, options.bridgeSecret, now());
      if (!verified.ok) {
        reply.code(401);
        return reply.send({ error: "invalid or expired token" });
      }
      if (!isSystemIngestToken(verified.payload)) {
        // Only the system-ingest principal may trigger extraction — a user token is refused here.
        reply.code(403);
        return reply.send({ error: "not permitted for this token" });
      }

      const { patientFhirId, pid, correlationId, subject } = verified.payload;
      // Disclosure log: a system-initiated PHI read has no human in the loop, so attribute it to the
      // system principal + correlation id (phi-and-secrets). PHI-free (pid + subject only).
      app.log.info({ correlationId, pid, subject }, "documents: system-triggered extraction started");

      // Fire-and-forget: acknowledge now, extract + cache after. The result is read later via the
      // physician's /documents/pending (cache hit). Errors are logged, never surfaced (no caller waits).
      void service
        .detectAndIngest(patientFhirId, { correlationId, logger: app.log })
        .then((drafts) => {
          app.log.info({ correlationId, pid, count: drafts.length }, "documents: system-triggered extraction done");
        })
        .catch((error: unknown) => {
          app.log.error({ correlationId, pid, err: error }, "documents: system-triggered extraction failed");
        });

      reply.code(202);
      return reply.send({ status: "accepted" });
    });
  };
}
