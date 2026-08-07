import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { signSessionToken } from "@copilot/session-token";

/**
 * DEV-ONLY mint endpoint. A local stand-in for the OpenEMR `GET /copilot/session-token`
 * bridge so the dev chat page, evals, and the API collection can obtain a token
 * without the PHP module running. It does **not** enforce ownership (any FHIR id can
 * be minted) — acceptable only against synthetic local data. Registered solely when
 * `devMint` is enabled (never in production, where the real bridge enforces ownership
 * per the authorization-and-pid-scope rule).
 */
const QuerySchema = z.object({ patientFhirId: z.string().min(1) });

const DEFAULT_TTL_SECONDS = 900; // 15 minutes — generous for local iteration.

export interface DevMintOptions {
  readonly bridgeSecret: string;
  readonly ttlSeconds?: number;
  /** Injected clock (Unix seconds) for deterministic tests. */
  readonly now?: () => number;
}

export function devMintRoutes(options: DevMintOptions): FastifyPluginAsync {
  const ttl = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));

  return async (app) => {
    app.get("/dev/session-token", async (request, reply) => {
      const parsed = QuerySchema.safeParse(request.query);
      if (!parsed.success) {
        reply.code(400);
        return { error: "patientFhirId is required" };
      }
      if (options.bridgeSecret.length === 0) {
        reply.code(503);
        return { error: "mint unavailable: bridge secret not configured" };
      }

      const token = signSessionToken(
        {
          userId: 6, // Dr. Donna Lee (dev default).
          pid: 1,
          patientFhirId: parsed.data.patientFhirId,
          correlationId: `dev-${String(request.id)}`,
          exp: now() + ttl,
        },
        options.bridgeSecret,
      );
      return { token };
    });
  };
}
