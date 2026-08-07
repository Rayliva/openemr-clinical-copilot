import type { FastifyPluginAsync } from "fastify";
import type { ReadinessRegistry } from "../readiness/registry.js";

/**
 * Readiness probe. Runs every registered dependency check and reports a three-state status:
 * `ready` / `degraded` / `not_ready` (W2, `W2_ARCHITECTURE §9`). HTTP 200 for `ready` OR
 * `degraded` (the service is up — a non-critical dependency like RAG being down degrades but does
 * not take it down), 503 only for `not_ready` (a critical dependency failed). Failing checks are
 * named but carry no internal error text (error-handling-and-logging rule) — the detail is logged.
 */
export function readyRoutes(registry: ReadinessRegistry): FastifyPluginAsync {
  return async (app) => {
    app.get("/ready", async (request, reply) => {
      const report = await registry.runAll((name, error) => {
        request.log.error({ check: name, err: error }, "readiness check failed");
      });

      reply.code(report.status === "not_ready" ? 503 : 200);
      return {
        status: report.status,
        checks: report.checks,
      };
    });
  };
}
