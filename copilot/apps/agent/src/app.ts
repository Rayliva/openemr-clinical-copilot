import Fastify, { type FastifyRequest, type FastifyServerOptions } from "fastify";
import { randomUUID } from "node:crypto";
import type { MetricsRegistry } from "@copilot/metrics";
import type { AgentDeps } from "./graph/types.js";
import type { RequestTracerFactory } from "./observability/tracing.js";
import { ReadinessRegistry } from "./readiness/registry.js";
import { chatRoutes } from "./routes/chat.js";
import { documentsRoutes } from "./routes/documents.js";
import { labsRoutes, type LabSeriesReader } from "./routes/labs.js";
import type { IngestionService } from "./ingestion/ingestionService.js";
import { devMintRoutes } from "./routes/devMint.js";
import { healthRoutes } from "./routes/health.js";
import { metricsRoutes } from "./routes/metrics.js";
import { readyRoutes } from "./routes/ready.js";
import { uiRoutes } from "./routes/ui.js";
import { versionRoutes } from "./routes/version.js";

/**
 * The correlation-id header. Minted at the OpenEMR bridge in production; here we
 * honour an inbound value and otherwise generate one, threading it through every
 * log line (as `correlationId`) and echoing it on the response so a request can
 * be traced end-to-end (ARCHITECTURE.md §2.6).
 */
export const CORRELATION_ID_HEADER = "x-correlation-id";

declare module "fastify" {
  interface FastifyInstance {
    /**
     * Every route registered on this instance, as `METHOD url` (e.g. `POST /chat`), populated
     * during `ready()`. Exists so the OpenAPI contract test can check the spec against the ACTUAL
     * registered set instead of a hand-maintained list that silently drifts. Includes the
     * auto-generated `HEAD` companion of each `GET` — consumers filter those.
     */
    readonly routeManifest: readonly string[];
  }
}

export interface BuildAppOptions {
  /** Dependency-check registry backing `/ready`. Defaults to an empty registry. */
  readonly readiness?: ReadinessRegistry;
  /** Fastify logger config. Pass `false` to silence (used in tests). */
  readonly logger?: FastifyServerOptions["logger"];
  /** Agent dependencies. When provided, `POST /chat` is registered. */
  readonly agent?: AgentDeps;
  /**
   * HMAC secret shared with the OpenEMR mint bridge (boundary #1). Required for
   * `/chat`: the pid comes from a token signed with this secret, never the body.
   * Defaults to empty, which makes every `/chat` request fail auth (fail-closed).
   */
  readonly bridgeSecret?: string;
  /**
   * Exact origin (the OpenEMR app origin) allowed to call `/chat` cross-origin from
   * the embedded chat UI. Unset => no CORS headers.
   */
  readonly allowedOrigin?: string;
  /**
   * DEV ONLY: register `GET /dev/session-token` (local mint stand-in for the PHP
   * bridge). Never enable in production — the real bridge enforces ownership.
   */
  readonly devMint?: boolean;
  /** Optional request tracer factory (Langfuse) for `/chat` observability. */
  readonly tracerFactory?: RequestTracerFactory;
  /** Live operational metrics window backing `/metrics` + `/dashboard` (E4). */
  readonly metrics?: MetricsRegistry;
  /**
   * Bearer token gating `/metrics` + `/dashboard`. Without it neither route is
   * registered — the snapshot carries no PHI, but it does reveal traffic volume and
   * error posture, so it is never exposed unauthenticated.
   */
  readonly metricsToken?: string;
  /**
   * Week-2 document ingestion service. When provided (and a bridge secret is set), registers
   * `POST /documents/pending` — the same fail-closed, token-bound gating as `/chat`.
   */
  readonly ingestionService?: IngestionService;
  /**
   * Week-2 lab-trend reader. When provided (and a bridge secret is set), registers
   * `POST /labs/series` — token-bound, pid-scoped, read-only (the trend widget's data source).
   */
  readonly labSeriesReader?: LabSeriesReader;
}

/**
 * Replace the VALUE of sensitive query params (the ops `token`, CSRF tokens) with a
 * placeholder so a secret in a request URL never reaches a log line. Pure + exported so
 * the redaction is unit-testable.
 */
export function redactUrlSecrets(url: string): string {
  return url.replace(/([?&](?:token|csrf_token_form|csrf_token)=)[^&#]*/gi, "$1[REDACTED]");
}

/** Build the Fastify app. Pure factory — no listening, so it is trivially testable. */
export function buildApp(options: BuildAppOptions = {}) {
  const readiness = options.readiness ?? new ReadinessRegistry();

  const app = Fastify({
    logger: options.logger ?? {
      level: process.env.LOG_LEVEL ?? "info",
      serializers: {
        // Fastify logs req.url including the query string. Strip sensitive query params
        // (the ops ?token= for /metrics|/dashboard|/alerts, and any csrf token) so a
        // secret never lands in the agent logs or a fronting proxy's access log.
        req(request: FastifyRequest) {
          return {
            method: request.method,
            url: redactUrlSecrets(request.url),
            hostname: request.hostname,
            remoteAddress: request.ip,
          };
        },
      },
    },
    // Fastify uses the inbound header value as the request id when present,
    // otherwise calls genReqId — giving us "echo if supplied, else generate".
    // The request id therefore *is* the correlation id; Fastify logs it on every
    // line for the request under the conventional `reqId` key.
    requestIdHeader: CORRELATION_ID_HEADER,
    genReqId: () => randomUUID(),
  });

  // Capture every route as it registers (onRoute fires for plugin/child-context routes too),
  // exposed as `app.routeManifest`. This is what gives the OpenAPI contract test teeth: it checks
  // the spec against the routes actually mounted here, so adding a route without documenting it
  // fails CI — a hand-maintained route table cannot provide that guarantee (it drifts silently,
  // which is exactly how `/labs/series` went undocumented).
  const routeManifest: string[] = [];
  app.addHook("onRoute", (routeOptions) => {
    const methods = Array.isArray(routeOptions.method) ? routeOptions.method : [routeOptions.method];
    for (const method of methods) {
      routeManifest.push(`${method} ${routeOptions.url}`);
    }
  });
  app.decorate("routeManifest", routeManifest);

  app.addHook("onRequest", async (request, reply) => {
    reply.header(CORRELATION_ID_HEADER, request.id);
  });

  // Never surface a raw error to the caller: internal messages may carry SQL, paths, or
  // PHI (`error-handling-and-logging` rule). Log the detail with the correlation id;
  // return a generic body. Fastify's default handler would echo error.message verbatim.
  app.setErrorHandler((error: unknown, request, reply) => {
    request.log.error({ correlationId: request.id, err: error }, "unhandled request error");
    // Preserve a client-error status if Fastify attached one (e.g. validation 4xx);
    // otherwise treat as 500. Never echo error.message.
    const statusCode =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof error.statusCode === "number" &&
      error.statusCode < 500
        ? error.statusCode
        : 500;
    reply
      .code(statusCode)
      .header(CORRELATION_ID_HEADER, request.id)
      .send({ error: "internal error", correlationId: request.id });
  });

  app.register(uiRoutes);
  app.register(healthRoutes);
  app.register(versionRoutes);
  app.register(readyRoutes(readiness));
  // Fail CLOSED: /chat is registered only when a non-empty bridge secret is configured.
  // Verifying tokens against an empty HMAC key would accept attacker-forged tokens, so
  // an unset secret must disable the route entirely, not silently authenticate everyone.
  if (options.agent !== undefined && (options.bridgeSecret ?? "") !== "") {
    app.register(
      chatRoutes(options.agent, {
        bridgeSecret: options.bridgeSecret ?? "",
        ...(options.allowedOrigin !== undefined ? { allowedOrigin: options.allowedOrigin } : {}),
        ...(options.tracerFactory !== undefined ? { tracerFactory: options.tracerFactory } : {}),
        ...(options.metrics !== undefined ? { metrics: options.metrics } : {}),
      }),
    );
  }
  // Fail CLOSED like /chat: document ingestion is token-bound (the patient comes from the
  // signed session token), so it is registered only with a non-empty bridge secret.
  if (options.ingestionService !== undefined && (options.bridgeSecret ?? "") !== "") {
    app.register(
      documentsRoutes(options.ingestionService, {
        bridgeSecret: options.bridgeSecret ?? "",
        ...(options.allowedOrigin !== undefined ? { allowedOrigin: options.allowedOrigin } : {}),
      }),
    );
  }
  // Fail-closed like /chat: the lab-trend reader is token-bound (pid from the signed token), so it
  // is registered only with a non-empty bridge secret.
  if (options.labSeriesReader !== undefined && (options.bridgeSecret ?? "") !== "") {
    app.register(
      labsRoutes(options.labSeriesReader, {
        bridgeSecret: options.bridgeSecret ?? "",
        ...(options.allowedOrigin !== undefined ? { allowedOrigin: options.allowedOrigin } : {}),
      }),
    );
  }
  if (options.devMint === true) {
    app.register(devMintRoutes({ bridgeSecret: options.bridgeSecret ?? "" }));
  }
  // Fail-closed: no token configured => the routes do not exist.
  if (options.metrics !== undefined && (options.metricsToken ?? "") !== "") {
    app.register(metricsRoutes({ metrics: options.metrics, token: options.metricsToken as string }));
  }

  return app;
}
