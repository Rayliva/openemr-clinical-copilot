import type { EvidenceSnippet } from "./contracts.js";

/**
 * Rerank the fused candidate snippets down to the few genuinely-relevant ones — feeding the raw
 * fused list to the answer model defeats the point (`w2-hybrid-rag`). The reranker is INJECTED
 * (Cohere rerank v3 in prod). Degrades, never hangs: if the reranker fails or returns nothing
 * usable, fall back to the fused top-K **labeled unreranked** (`error-handling-and-logging`,
 * circuit-breaker intent).
 */

/**
 * The injected reranker. Given the query and candidate document texts, returns candidate indices
 * with relevance scores, most-relevant first (the shape Cohere rerank returns). Pure package sees
 * only this port.
 */
export type RerankFn = (
  query: string,
  documents: readonly string[],
) => Promise<readonly { readonly index: number; readonly relevanceScore: number }[]>;

export interface RerankResult {
  readonly snippets: readonly EvidenceSnippet[];
  /** `false` = the reranker failed/was unusable and `snippets` is the unreranked fused fallback. */
  readonly reranked: boolean;
}

export interface RerankOptions {
  /** Keep at most this many after reranking (default 5). */
  readonly topN?: number;
}

const DEFAULT_TOP_N = 5;

export async function rerankEvidence(
  query: string,
  candidates: readonly EvidenceSnippet[],
  reranker: RerankFn,
  options: RerankOptions = {},
): Promise<RerankResult> {
  const topN = options.topN ?? DEFAULT_TOP_N;
  if (candidates.length === 0) {
    return { snippets: [], reranked: false };
  }

  const fallback = (): RerankResult => ({ snippets: candidates.slice(0, topN), reranked: false });

  let ranked: readonly { index: number; relevanceScore: number }[];
  try {
    ranked = await reranker(
      query,
      candidates.map((c) => c.text),
    );
  } catch {
    // Reranker unavailable → degrade to the fused order, never hang the turn.
    return fallback();
  }

  const reranked: EvidenceSnippet[] = [];
  for (const r of ranked) {
    if (reranked.length >= topN) {
      break;
    }
    const snippet = candidates[r.index]; // ignore out-of-range indices — never a wrong/blank citation
    if (snippet !== undefined) {
      reranked.push({ ...snippet, score: r.relevanceScore });
    }
  }

  return reranked.length === 0 ? fallback() : { snippets: reranked, reranked: true };
}
