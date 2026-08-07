import { z } from "zod";
import type { RerankFn } from "@copilot/rag";

/**
 * The concrete Cohere rerank v3 implementation of `@copilot/rag`'s injected `RerankFn`. Thin
 * adapter: POST to Cohere v2 /rerank, Zod-parse the results. The query may carry patient specifics
 * (documented egress tradeoff, `phi-and-secrets`); errors are PHI-free (status only). The circuit-
 * breaker fallback (rerank failure → unreranked fused top-k) lives in the pure `rerankEvidence`.
 */

export interface CohereRerankOptions {
  readonly apiKey: string;
  /** Cohere rerank model (default `rerank-v3.5`). */
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly fetchFn?: typeof fetch;
}

const DEFAULT_MODEL = "rerank-v3.5";
const DEFAULT_TIMEOUT_MS = 30_000;
const RERANK_URL = "https://api.cohere.com/v2/rerank";

const RerankResponse = z.object({
  results: z.array(z.object({ index: z.number().int(), relevance_score: z.number() })),
});

export function createCohereRerank(options: CohereRerankOptions): RerankFn {
  const fetchFn = options.fetchFn ?? fetch;
  const model = options.model ?? DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async (query, documents) => {
    if (documents.length === 0) {
      return [];
    }
    const response = await fetchFn(RERANK_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model, query, documents, top_n: documents.length }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Cohere rerank failed: HTTP ${response.status}`);
    }

    const parsed = RerankResponse.parse(await response.json());
    return parsed.results.map((r) => ({ index: r.index, relevanceScore: r.relevance_score }));
  };
}
