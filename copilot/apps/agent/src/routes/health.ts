import type { FastifyPluginAsync } from "fastify";

/**
 * Liveness probe. Cheap by design: answers "is the process up?" with no I/O and
 * no external calls. Readiness of dependencies is `/ready`'s job.
 */
export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async () => ({ status: "ok" as const }));
};
