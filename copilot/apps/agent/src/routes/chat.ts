import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { MetricsRegistry } from "@copilot/metrics";
import { verifySessionToken, isSystemIngestToken } from "@copilot/session-token";
import { buildAgentGraph } from "../graph/graph.js";
import { buildClaimCitations, toProvenanceTableIndex } from "../graph/machineCitations.js";
import { evaluateEncounter } from "../observability/encounterEval.js";
import type { AgentDeps } from "../graph/types.js";
import { withTracer, type RequestTracerFactory } from "../observability/tracing.js";
import type { EvidenceSnippet } from "@copilot/rag";

/**
 * The `/chat` body no longer carries `patientId`: the pid the agent operates on is
 * bound by the signed session token, never chosen by the caller
 * (`authorization-and-pid-scope` rule). Any `patientId` a client still sends is
 * ignored — `.passthrough()` tolerates it but nothing reads it.
 */
const ChatBodySchema = z
  .object({
    messages: z
      .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1) }))
      .min(1),
  })
  .passthrough();

/**
 * A cited source, tagged by kind for the in-chat "view source" viewer (`w2-inline-source-viewer`).
 * A guideline chunk carries its passage text (rendered inline — the corpus is markdown, no image);
 * a chart row carries only its ref (the OpenEMR module resolves whether it traces to a source
 * document + bounding box, which the agent does not know). Serialized into the `/chat` done frame.
 */
export type CitedSource =
  | {
      readonly ref: string;
      readonly kind: "guideline";
      readonly doc: string;
      readonly section: string;
      readonly text: string;
      readonly page?: number;
    }
  | { readonly ref: string; readonly kind: "chart" };

/**
 * Tag each cited `sourceRef` by kind for the in-chat source viewer. A ref that matches a retrieved
 * guideline chunk (`evidence[].chunkId`) becomes a guideline source carrying its passage text; every
 * other ref is a chart row (the module resolves whether it traces to a source document). Pure + total.
 */
export function tagCitedSources(
  sourceRefs: readonly string[],
  evidence: readonly EvidenceSnippet[],
): CitedSource[] {
  const byRef = new Map(evidence.map((e) => [e.chunkId, e]));
  return sourceRefs.map((ref): CitedSource => {
    const snip = byRef.get(ref);
    if (snip === undefined) {
      return { ref, kind: "chart" };
    }
    return {
      ref,
      kind: "guideline",
      doc: snip.doc,
      section: snip.section,
      text: snip.text,
      ...(snip.page !== undefined ? { page: snip.page } : {}),
    };
  });
}

export interface ChatRouteOptions {
  /** HMAC secret shared with the mint bridge; verifies the session token. */
  readonly bridgeSecret: string;
  /**
   * Exact origin allowed to call `/chat` cross-origin (the OpenEMR app origin that
   * serves the embedded chat UI). Unset => no CORS headers (same-origin only).
   */
  readonly allowedOrigin?: string;
  readonly tracerFactory?: RequestTracerFactory;
  /** Live operational metrics window; each completed turn is recorded to it (E4). */
  readonly metrics?: MetricsRegistry;
  /** Injected clock (Unix seconds) for deterministic expiry checks in tests. */
  readonly now?: () => number;
}

/** The exact allowed origin if the request origin matches it, else null (no wildcard). */
export function resolveCorsOrigin(
  requestOrigin: string | undefined,
  allowedOrigin: string | undefined,
): string | null {
  if (allowedOrigin === undefined || allowedOrigin.length === 0) {
    return null;
  }
  return requestOrigin === allowedOrigin ? allowedOrigin : null;
}

/** Encode a (already-verified) answer as SSE data frames — one per word chunk. */
export function sseAnswerChunks(answer: string): string[] {
  const parts = answer.match(/\S+\s*/g) ?? [];
  return parts.map((part) => `data: ${JSON.stringify({ delta: part })}\n\n`);
}

/** Extract a bearer token from an `Authorization` header, or null if absent/other. */
export function extractBearerToken(header: string | undefined): string | null {
  if (header === undefined) {
    return null;
  }
  const match = /^Bearer (.+)$/.exec(header.trim());
  return match?.[1] ?? null;
}

function defaultNow(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * `POST /chat` — multi-turn conversational endpoint. The patient is bound by the
 * boundary-#1 session token (`Authorization: Bearer …`): the token is verified on
 * every request (signature → expiry → shape) and the pid comes from it, not the
 * body. Unverified requests are refused with 401 before any chart read. Nothing
 * unverified is streamed: the graph verifies before `respond` renders.
 */
export function chatRoutes(deps: AgentDeps, options: ChatRouteOptions): FastifyPluginAsync {
  const now = options.now ?? defaultNow;

  return async (app) => {
    // Default the graph's boundary logger to the Fastify logger so tool/LLM failures are
    // visible in the logs even when the (opt-in) tracer is off.
    const graph = buildAgentGraph({ ...deps, logger: deps.logger ?? app.log });
    // CORS preflight for the cross-origin embedded UI. Only the configured origin
    // is answered; the token (not a cookie) is the auth, so no credentials flag.
    app.options("/chat", async (request, reply) => {
      const origin = resolveCorsOrigin(request.headers.origin, options.allowedOrigin);
      if (origin !== null) {
        reply
          .header("access-control-allow-origin", origin)
          .header("access-control-allow-methods", "POST, OPTIONS")
          .header("access-control-allow-headers", "authorization, content-type")
          .header("vary", "origin");
      }
      reply.code(204);
      return null;
    });

    app.post("/chat", async (request, reply) => {
      // Emit CORS headers early so they are present on every path (incl. 401/400),
      // letting the browser read the outcome cross-origin.
      const corsOrigin = resolveCorsOrigin(request.headers.origin, options.allowedOrigin);
      if (corsOrigin !== null) {
        reply.header("access-control-allow-origin", corsOrigin).header("vary", "origin");
      }

      // Boundary #1: authorize before doing anything with the request.
      const token = extractBearerToken(request.headers.authorization);
      if (token === null) {
        reply.code(401);
        return { error: "unauthorized" };
      }
      const verified = verifySessionToken(token, options.bridgeSecret, now());
      if (!verified.ok) {
        request.log.warn(
          { correlationId: String(request.id), reason: verified.reason },
          "chat auth rejected",
        );
        reply.code(401);
        return { error: "unauthorized" };
      }
      // A confined system-ingest token (upload trigger) must never reach the chat/answer path.
      if (isSystemIngestToken(verified.payload)) {
        reply.code(403);
        return { error: "forbidden" };
      }
      const { patientFhirId, correlationId } = verified.payload;

      const parsed = ChatBodySchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400);
        return { error: "invalid request body" };
      }

      const question = [...parsed.data.messages].reverse().find((m) => m.role === "user")?.content;
      const tracer = options.tracerFactory?.start({
        name: "chat",
        correlationId,
        input: { patientId: patientFhirId, question },
      });

      // Timed from here: an unauthorized or malformed request is not a turn, and must
      // not pollute the latency window or the error rate.
      const startedAt = performance.now();
      let outcome;
      try {
        outcome = await withTracer(tracer, () =>
          graph.invoke({ patientId: patientFhirId, messages: parsed.data.messages, correlationId }),
        );
      } catch (error) {
        options.metrics?.recordTurn({
          latencyMs: performance.now() - startedAt,
          failed: true,
          verdictOk: false,
        });
        throw error;
      }

      // The badge is green only when the answer passed BOTH the citation gate (L1)
      // and the grounding judge (L2 dropped nothing).
      const fullyVerified = (outcome.verdict?.ok ?? false) && outcome.ungrounded.length === 0;

      // A degraded or unverified answer is a completed request, not a failed one.
      options.metrics?.recordTurn({
        latencyMs: performance.now() - startedAt,
        failed: false,
        verdictOk: fullyVerified,
      });

      // Per-encounter eval outcome (Core Req 7): the deterministic boolean rubric categories
      // evaluated on THIS turn's own output (the two needing a golden expectation stay CI-only).
      // Booleans only — PHI-free.
      const evalOutcome = evaluateEncounter({
        generationOk: outcome.generationOk ?? true,
        groundedClaims: outcome.groundedClaims,
        retrievedRefs: outcome.retrievedRefs,
        ungroundedCount: outcome.ungrounded.length,
      });
      // Feed the per-category eval counters that back the `eval_regression_detection` alert.
      options.metrics?.recordEval({
        schema_valid: evalOutcome.schema_valid,
        citation_present: evalOutcome.citation_present,
        grounding_ok: evalOutcome.grounding_ok,
        no_phi_in_logs: evalOutcome.no_phi_in_logs,
      });

      tracer?.end({ answer: outcome.answer, verdictOk: fullyVerified, evalOutcome });
      request.log.info(
        {
          correlationId,
          usage: outcome.usage,
          verdictOk: fullyVerified,
          findings: outcome.findings.length,
          ungrounded: outcome.ungrounded.length,
          evalOutcome,
        },
        "chat completed",
      );

      reply.raw.setHeader("content-type", "text/event-stream");
      reply.raw.setHeader("cache-control", "no-cache");
      reply.raw.setHeader("connection", "keep-alive");
      reply.raw.setHeader("x-correlation-id", correlationId);
      // Hijacking bypasses Fastify's header serialization, so re-set CORS on the raw
      // stream (the reply.header() above only covers non-hijacked responses).
      if (corsOrigin !== null) {
        reply.raw.setHeader("access-control-allow-origin", corsOrigin);
        reply.raw.setHeader("vary", "origin");
      }
      reply.hijack();

      for (const frame of sseAnswerChunks(outcome.answer)) {
        reply.raw.write(frame);
      }
      // Tag each cited source for the in-chat "view source" viewer (`w2-inline-source-viewer` Slice A):
      // guideline chunks carry their passage text; chart rows carry only the ref (module resolves docs).
      const evidence = outcome.evidence ?? [];
      // Resolve each cited chart row to its OpenEMR source table (page_or_section) + serialized
      // content (quote_or_value) so a chart claim's citation carries the full 5-field machine shape,
      // not just a bare ref (`w2-citation-completeness`). Deterministic, from provenance — no model.
      const provenanceIndex = toProvenanceTableIndex(outcome.facts, outcome.documents ?? []);
      const evidenceIndex = outcome.evidenceIndex ?? {};
      reply.raw.write(
        `event: done\ndata: ${JSON.stringify({
          verdictOk: fullyVerified,
          findings: outcome.findings,
          // The machine-readable citation contract: each VERIFIED claim mapped to the source(s) that
          // back it. `groundedClaims` = claims that passed BOTH the citation gate and the grounding
          // judge (exactly what the streamed body is built from), so no dropped/ungrounded (potentially
          // fabricated) statement is ever exposed. `citation` is the canonical 5-field machine shape
          // ({source_type, source_id, page_or_section, field_or_chunk_id, quote_or_value}) for chart
          // AND guideline refs; `sources` (camelCase, viewer metadata) + `sourceRefs` kept for the UI.
          citations: outcome.groundedClaims.map((c) => ({
            statement: c.statement,
            sourceRefs: c.sourceRefs,
            sources: tagCitedSources(c.sourceRefs, evidence),
            citation: buildClaimCitations(c.sourceRefs, evidence, provenanceIndex, evidenceIndex),
          })),
          // Never ship the raw dropped-claim TEXT to the client: those statements are
          // exactly what the grounding judge ruled unsupported (potentially fabricated
          // clinical content). Send only the judge's reason (count = array length),
          // matching renderUnverifiedSection's server-side body treatment.
          ungrounded: outcome.ungrounded.map((u) => ({ reason: u.reason })),
          // Layer-4 critic vetoes: count + reason only, never the withheld statement (an
          // action suggestion is exactly the text we must not surface to the client).
          withheld: outcome.withheld.map((w) => ({ reason: w.reason })),
        })}\n\n`,
      );
      reply.raw.end();

      // Ship the trace to Langfuse OFF the critical path: the answer is already streamed,
      // so trace delivery (a network round-trip, batched by the SDK) must never gate the
      // physician's response — nor let a Langfuse outage slow or stall it. Fire-and-forget.
      if (options.tracerFactory !== undefined) {
        void options.tracerFactory.flush().catch((err: unknown) => {
          request.log.error({ err, correlationId }, "langfuse trace flush failed");
        });
      }
    });
  };
}
