import { createHttpReadinessCheck, type FetchFn } from "../readiness/httpCheck.js";
import type { ReadinessCheckFn } from "../readiness/registry.js";

/**
 * Readiness check for the Cohere embed/rerank provider — the W2 guideline-RAG dependency (the
 * "vector index / reranker API" of `W2_ARCHITECTURE §9`). Probes Cohere's `GET /v1/models` with the
 * API key, which validates the key without spending tokens. Registered **non-critical**: RAG being
 * down degrades the service (chart answers keep working), it does not take it down.
 */
export interface CohereReadinessOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetchFn?: FetchFn;
  readonly timeoutMs?: number;
}

export function createCohereReadinessCheck(options: CohereReadinessOptions): ReadinessCheckFn {
  const baseUrl = (options.baseUrl ?? "https://api.cohere.com").replace(/\/$/, "");
  return createHttpReadinessCheck({
    url: `${baseUrl}/v1/models`,
    headers: { authorization: `Bearer ${options.apiKey}` },
    timeoutMessage: "cohere probe timed out",
    ...(options.fetchFn !== undefined ? { fetchFn: options.fetchFn } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  });
}
