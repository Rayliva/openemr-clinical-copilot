import type { MetricsRegistry } from "@copilot/metrics";
import type { EvidenceSnippet } from "@copilot/rag";

/**
 * The per-query retrieval orchestration for the evidence-retriever worker, extracted as a pure,
 * offline-testable unit (`orchestrator-only`): run the injected fused retrieval + rerank, record the
 * W2 retrieval signals (hits, rerank used-vs-degraded, round-trip latency), and return the evidence
 * plus the rerank status. The rerank degrade-to-fused fallback lives in `@copilot/rag`
 * (`rerankEvidence` returns `reranked: false`); this maps it onto the metric + a log-friendly status.
 */

export interface RetrievalRun {
  /** Dense+keyword fused retrieval (pre-rerank). */
  readonly fusedRetrieve: (query: string) => Promise<readonly EvidenceSnippet[]>;
  /** Rerank the fused candidates; `reranked: false` = fell back to the fused order (unreranked). */
  readonly rerank: (
    query: string,
    fused: readonly EvidenceSnippet[],
  ) => Promise<{ readonly snippets: readonly EvidenceSnippet[]; readonly reranked: boolean }>;
}

export interface RetrievalOutcome {
  readonly evidence: readonly EvidenceSnippet[];
  readonly rerank: "used" | "degraded";
}

export async function runRetrieval(
  query: string,
  run: RetrievalRun,
  metrics?: MetricsRegistry,
): Promise<RetrievalOutcome> {
  const startedAt = performance.now();
  const fused = await run.fusedRetrieve(query);
  const reranked = await run.rerank(query, fused);
  const rerank: "used" | "degraded" = reranked.reranked ? "used" : "degraded";
  metrics?.recordRetrieval({
    snippets: reranked.snippets.length,
    rerank,
    latencyMs: performance.now() - startedAt,
  });
  return { evidence: reranked.snippets, rerank };
}
