import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createNodeFetch } from "@copilot/openemr-client";
import { wireAgentDeps } from "./agent/wire.js";
import { buildIngestionService } from "./ingestion/ingestionService.js";
import { loadOpenEmrFhirClient } from "./openemr/loadClient.js";
import {
  buildLabSeries,
  attachReferenceRanges,
  mapFhirPatient,
  bundleResources,
  type LabSeriesResult,
  type PatientContext,
} from "@copilot/snapshot";
import { createMetricsRegistry } from "@copilot/metrics";
import { buildApp } from "./app.js";
import { createClaudeGenerate } from "./graph/claudeGenerate.js";
import { createGroundingJudge } from "./graph/groundingJudge.js";
import { createLangfuseTracerFactory } from "./observability/langfuse.js";
import { createAnthropicReadinessCheck } from "./anthropic/readiness.js";
import { createCohereReadinessCheck } from "./cohere/readiness.js";
import { createLangfuseReadinessCheck } from "./langfuse/readiness.js";
import { createOpenEmrReadinessCheck } from "./openemr/readiness.js";
import { ReadinessRegistry } from "./readiness/registry.js";
import { createRedisClient } from "./redis/client.js";
import { createRedisReadinessCheck } from "./redis/readiness.js";

// Load copilot/.env (secrets live there, git-ignored) before reading config.
const copilotRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
loadEnv({ path: resolve(copilotRoot, ".env") });

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const OPENEMR_BASE_URL = process.env.OPENEMR_BASE_URL ?? "https://localhost:9300";
const OPENEMR_PROBE_TIMEOUT_MS = Number(process.env.OPENEMR_PROBE_TIMEOUT_MS ?? 8000);
// DEV ONLY: local OpenEMR uses a self-signed cert. Never set true in production.
const OPENEMR_INSECURE_TLS = process.env.OPENEMR_INSECURE_TLS === "true";
const LANGFUSE_HOST = process.env.LANGFUSE_HOST ?? "http://localhost:3001";
const LANGFUSE_PUBLIC_KEY = process.env.LANGFUSE_PUBLIC_KEY ?? "";
const LANGFUSE_SECRET_KEY = process.env.LANGFUSE_SECRET_KEY ?? "";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";
// Vision model for W2 document extraction — Opus-class by default (extract-once, accuracy > cost;
// the OCR/model-tiering decision). Overridable, never hardcoded in the adapter.
const VLM_MODEL = process.env.COPILOT_VLM_MODEL ?? "claude-opus-4-8";
// Verification layer 2 (grounding judge). Opt-in: it adds one cheap LLM call per
// claim. Model defaults to Haiku (entailment is a narrow task).
const COPILOT_GROUNDING_JUDGE = process.env.COPILOT_GROUNDING_JUDGE === "true";
const GROUNDING_MODEL = process.env.COPILOT_GROUNDING_MODEL ?? "claude-haiku-4-5";
// Supervisor routing model. Routing is a narrow typed classification (which worker, or straight to
// generate), NOT generation — so it defaults to Haiku, far faster + cheaper than the generation model.
// This directly cuts the per-turn latency the supervisor adds (the W2 tail-latency cost measured in
// loadtest/results-2026-07-15-siteB). Overridable; never hardcoded in the node (model-role abstraction).
const SUPERVISOR_MODEL = process.env.COPILOT_SUPERVISOR_MODEL ?? "claude-haiku-4-5";
// Boundary-#1 HMAC secret, shared with the OpenEMR mint bridge. Empty => /chat
// fails closed (every request 401) since no token can be verified.
const COHERE_API_KEY = process.env.COHERE_API_KEY ?? "";
const COPILOT_BRIDGE_SECRET = process.env.COPILOT_BRIDGE_SECRET ?? "";
// DEV ONLY: enable the local mint endpoint (bypasses ownership). Hard-guarded off in
// production regardless of the flag, so an example env copied toward prod cannot expose
// an unauthenticated, ownership-skipping token minter.
const COPILOT_DEV_MINT =
  process.env.COPILOT_DEV_MINT === "true" && process.env.NODE_ENV !== "production";
if (process.env.COPILOT_DEV_MINT === "true" && process.env.NODE_ENV === "production") {
  // eslint-disable-next-line no-console
  console.warn("COPILOT_DEV_MINT=true ignored: the dev mint endpoint is never enabled when NODE_ENV=production");
}
// Exact OpenEMR app origin allowed to call /chat cross-origin from the embedded UI.
const COPILOT_ALLOWED_ORIGIN = process.env.COPILOT_ALLOWED_ORIGIN ?? "";
// Bearer token for /metrics + /dashboard. Empty => neither route is registered.
const COPILOT_METRICS_TOKEN = process.env.COPILOT_METRICS_TOKEN ?? "";
const COPILOT_METRICS_WINDOW = Number(process.env.COPILOT_METRICS_WINDOW ?? 1000);

// The live operational window (E4). Not durable by design — Langfuse holds history.
const metrics = createMetricsRegistry({ windowSize: COPILOT_METRICS_WINDOW });

const redis = createRedisClient(REDIS_URL);
const openemrFetch = createNodeFetch({ insecureTls: OPENEMR_INSECURE_TLS });

const readiness = new ReadinessRegistry()
  .register("redis", createRedisReadinessCheck(redis))
  .register(
    "openemr",
    createOpenEmrReadinessCheck({
      baseUrl: OPENEMR_BASE_URL,
      timeoutMs: OPENEMR_PROBE_TIMEOUT_MS,
      fetchFn: openemrFetch,
    }),
  )
  .register("langfuse", createLangfuseReadinessCheck({ baseUrl: LANGFUSE_HOST }));

// Anthropic backs /chat generation. Probe it CRITICAL only when a key is configured (prod). In the
// supported keyless STUB mode (dev/CI — which the eval gate mandates: offline, no live key) /chat
// serves via the deterministic stub, so a live Anthropic probe would 401 and wrongly force
// `not_ready`/503 on a healthy instance. Skip it when keyless.
if (ANTHROPIC_API_KEY.length > 0) {
  readiness.register("anthropic", createAnthropicReadinessCheck({ apiKey: ANTHROPIC_API_KEY }));
}

// W2 dependency probe: document storage — uploaded source documents live in OpenEMR (FHIR
// DocumentReference/Binary), so this probes OpenEMR document reachability. Non-critical: if it is
// down, ingestion degrades but chart answers keep working (`W2_ARCHITECTURE §9`).
readiness.register(
  "document_storage",
  createOpenEmrReadinessCheck({ baseUrl: OPENEMR_BASE_URL, timeoutMs: OPENEMR_PROBE_TIMEOUT_MS, fetchFn: openemrFetch }),
  { critical: false },
);

// Wire the agent: real demographics tool (via the registered OpenEMR client) plus
// the generate function — real Claude when a key is present, else the dev stub.
const usingClaude = ANTHROPIC_API_KEY.length > 0;
const usingGroundingJudge = usingClaude && COPILOT_GROUNDING_JUDGE;
const usingRag = COHERE_API_KEY.length > 0;

// W2 dependency probe: the reranker (Cohere rerank API reachability). Registered NON-CRITICAL — when
// it is down, /ready reports `degraded` (not `not_ready`): chart answers keep working and the circuit
// breaker falls back to the fused order (`W2_ARCHITECTURE §9`).
if (usingRag) {
  readiness.register("reranker", createCohereReadinessCheck({ apiKey: COHERE_API_KEY }), { critical: false });
}
const agent = await wireAgentDeps({
  copilotRoot,
  openemrBaseUrl: OPENEMR_BASE_URL,
  openemrFetch,
  metrics,
  modelName: usingClaude ? ANTHROPIC_MODEL : "dev-stub",
  ...(usingClaude
    ? {
        generate: createClaudeGenerate({ apiKey: ANTHROPIC_API_KEY, model: ANTHROPIC_MODEL }),
        // Agentic gather: the model selects which optional tools (vitals/labs/immunizations)
        // to call per question. Uses the same Claude model as generation.
        gather: { apiKey: ANTHROPIC_API_KEY, model: ANTHROPIC_MODEL },
      }
    : {}),
  // W2 guideline RAG + supervisor: the model routes guideline questions to the evidence-retriever.
  ...(usingRag ? { rag: { cohereApiKey: COHERE_API_KEY } } : {}),
  // Supervisor is wired whenever Claude is present — the intake-extractor worker needs no Cohere, so
  // the multi-agent layer must NOT vanish without a Cohere key (it would silently degrade to W1 and
  // leave intake_extractor unreachable). evidence_retriever is added by wire.ts only when RAG is on.
  // Routes with SUPERVISOR_MODEL (Haiku by default), not the generation model — cheaper + lower latency.
  ...(usingClaude ? { supervisor: { apiKey: ANTHROPIC_API_KEY, model: SUPERVISOR_MODEL } } : {}),
  ...(usingGroundingJudge
    ? {
        groundingJudge: createGroundingJudge({ apiKey: ANTHROPIC_API_KEY, model: GROUNDING_MODEL }),
        groundingModelName: GROUNDING_MODEL,
      }
    : {}),
});

// W2 dependency probe: the in-memory guideline vector index (built from the committed corpus at
// startup). `ready` ⇔ the evidence retriever is wired (the index built); if RAG was requested but the
// index failed to build, this reports `error` → `degraded`. Non-critical.
if (usingRag) {
  readiness.register("vector_index", () => agent !== null && agent.evidenceRetriever !== undefined, {
    critical: false,
  });
}

// W2 document ingestion service (POST /documents/pending). Needs the registered OpenEMR client
// (.secrets) + an Anthropic key for the VLM; null otherwise → the route is simply not exposed.
// Adapt the ioredis client to the ingestion cache's semantic RedisLike (keeps ioredis's overload
// noise at this one edge).
const ingestRedis = {
  get: (key: string): Promise<string | null> => redis.get(key),
  setWithTtl: async (key: string, value: string, ttlSeconds: number): Promise<void> => {
    await redis.set(key, value, "EX", ttlSeconds);
  },
  setNxWithTtl: async (key: string, value: string, ttlSeconds: number): Promise<boolean> =>
    (await redis.set(key, value, "EX", ttlSeconds, "NX")) === "OK",
  del: async (key: string): Promise<void> => {
    await redis.del(key);
  },
};
const ingestionService = await buildIngestionService({
  copilotRoot,
  openemrBaseUrl: OPENEMR_BASE_URL,
  openemrFetch,
  anthropicApiKey: ANTHROPIC_API_KEY,
  vlmModel: VLM_MODEL,
  redis: ingestRedis,
  // W2 ingestion signals feed the same live operational window as /chat.
  metrics,
});

// Lab-trend reader for POST /labs/series: read the bound patient's laboratory Observations and
// group them into per-test time series. Its own FHIR client via the shared loader (read-only edge);
// null when no OpenEMR client is registered, in which case the route is simply not registered.
const labsFhir = await loadOpenEmrFhirClient({ copilotRoot, openemrBaseUrl: OPENEMR_BASE_URL, openemrFetch });
const labSeriesReader =
  labsFhir === null
    ? undefined
    : async (patientFhirId: string): Promise<LabSeriesResult> => {
        const now = new Date();
        const series = buildLabSeries(
          await labsFhir.search("Observation", { patient: patientFhirId, category: "laboratory" }),
          "procedure_result",
          now,
        );
        // Age + sex for the chart's reference-range context — read the bound patient's OWN
        // demographics (deterministic, in-boundary). If it fails, ranges simply don't attach (no
        // band) rather than a guessed range (`w2-lab-reference-ranges`).
        let ctx: PatientContext = {};
        try {
          const patientResource = bundleResources(
            await labsFhir.search("Patient", { _id: patientFhirId }),
          )[0];
          if (patientResource !== undefined) {
            const demo = mapFhirPatient(patientResource, now);
            ctx = {
              ...(demo.age !== undefined ? { ageYears: demo.age } : {}),
              ...(demo.gender !== undefined ? { sex: demo.gender } : {}),
            };
          }
        } catch {
          // Demographics are optional context for the band; never fail the trend read on them.
        }
        return attachReferenceRanges(series, ctx);
      };

// Self-hosted Langfuse tracing for /chat (enabled when its keys are present).
const tracerFactory =
  LANGFUSE_PUBLIC_KEY.length > 0 && LANGFUSE_SECRET_KEY.length > 0
    ? createLangfuseTracerFactory({
        host: LANGFUSE_HOST,
        publicKey: LANGFUSE_PUBLIC_KEY,
        secretKey: LANGFUSE_SECRET_KEY,
      })
    : undefined;

const app = buildApp({
  readiness,
  ...(agent !== null ? { agent } : {}),
  bridgeSecret: COPILOT_BRIDGE_SECRET,
  ...(COPILOT_ALLOWED_ORIGIN.length > 0 ? { allowedOrigin: COPILOT_ALLOWED_ORIGIN } : {}),
  devMint: COPILOT_DEV_MINT,
  ...(tracerFactory !== undefined ? { tracerFactory } : {}),
  ...(ingestionService !== null ? { ingestionService } : {}),
  ...(labSeriesReader !== undefined ? { labSeriesReader } : {}),
  metrics,
  metricsToken: COPILOT_METRICS_TOKEN,
});

if (agent === null) {
  app.log.warn("no OpenEMR client registered in .secrets — POST /chat is disabled");
} else if (COPILOT_BRIDGE_SECRET.length === 0) {
  app.log.warn("COPILOT_BRIDGE_SECRET is unset — POST /chat is NOT registered (fail-closed); set the secret to enable it");
} else {
  if (COPILOT_DEV_MINT) {
    app.log.warn("COPILOT_DEV_MINT=true — GET /dev/session-token is enabled (dev only, no ownership check)");
  }
  app.log.info(
    {
      generate: usingClaude ? `claude:${ANTHROPIC_MODEL}` : "dev-stub",
      supervisor: usingClaude ? `claude:${SUPERVISOR_MODEL}` : "off",
      groundingJudge: usingGroundingJudge ? `claude:${GROUNDING_MODEL}` : "off",
    },
    "agent wired for /chat",
  );
}

// ioredis emits `error` events; without a listener the process would crash.
redis.on("error", (error: unknown) => {
  app.log.error({ err: error }, "redis client error");
});

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "shutting down");
  await app.close();
  redis.disconnect();
  if (tracerFactory !== undefined) {
    await tracerFactory.shutdown();
  }
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

app.listen({ port: PORT, host: HOST }).catch((error: unknown) => {
  app.log.error({ err: error }, "failed to start server");
  process.exit(1);
});
