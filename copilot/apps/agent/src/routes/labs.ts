import type { FastifyPluginAsync } from "fastify";
import { verifySessionToken, isSystemIngestToken } from "@copilot/session-token";
import type { LabSeriesResult } from "@copilot/snapshot";
import { resolveCorsOrigin, extractBearerToken } from "./chat.js";

/**
 * `POST /labs/series` — the lab-trend data endpoint. Returns the bound patient's lab results grouped
 * into per-test time series (the union of every committed extracted lab reading across all uploaded
 * PDFs), for the widget's trend chart. The patient is fixed by the verified session token
 * (`authorization-and-pid-scope`) — the body carries nothing patient-selecting. Read-only, no LLM: a
 * deterministic data view (like the review UI), so it does not pass the generation gate, but every
 * point carries its Observation provenance and the request is pid-bound + fail-closed.
 */

/** Reads the bound patient's lab time series (built from the FHIR Observation searchset). Injected. */
export type LabSeriesReader = (patientFhirId: string) => Promise<LabSeriesResult>;

export interface LabsRouteOptions {
  readonly bridgeSecret: string;
  readonly allowedOrigin?: string;
  readonly now?: () => number;
}

const defaultNow = (): number => Math.floor(Date.now() / 1000);

export function labsRoutes(readSeries: LabSeriesReader, options: LabsRouteOptions): FastifyPluginAsync {
  const now = options.now ?? defaultNow;

  return async (app) => {
    app.options("/labs/series", async (request, reply) => {
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

    app.post("/labs/series", async (request, reply) => {
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
        app.log.warn({ correlationId: String(request.id), reason: verified.reason }, "labs: token rejected");
        reply.code(401);
        return reply.send({ error: "invalid or expired token" });
      }
      // A confined system-ingest token may only reach /documents/extract — never a read path.
      if (isSystemIngestToken(verified.payload)) {
        reply.code(403);
        return reply.send({ error: "not permitted for this token" });
      }

      const { patientFhirId, correlationId } = verified.payload;
      try {
        const result = await readSeries(patientFhirId);
        reply.header("x-correlation-id", correlationId);
        return reply.send(result);
      } catch (error) {
        // Boundary catch: log the detail (PHI-free), return a generic message; never expose internals.
        app.log.error({ correlationId, err: error }, "labs: series read failed");
        reply.code(502);
        return reply.send({ error: "lab series read failed" });
      }
    });
  };
}
