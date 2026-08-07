/**
 * Reciprocal Rank Fusion of ≥1 ranked lists (dense ANN + keyword full-text). Each item's fused
 * score = Σ 1/(k + rank) across the lists it appears in, keyed by `chunkId`. Pure + deterministic:
 * the ranked lists are inputs (produced by the retrieval slice); fusion has no IO. Dense alone
 * misses exact drug names/codes; keyword alone misses paraphrase — so we fuse, never pick one
 * (`w2-hybrid-rag`).
 */

export interface RankedItem {
  readonly chunkId: string;
}

export interface FusedItem {
  readonly chunkId: string;
  readonly score: number;
}

export interface FuseOptions {
  /** RRF constant; larger flattens the rank contribution (default 60, the common value). */
  readonly k?: number;
}

const DEFAULT_K = 60;

export function fuseRRF(
  lists: readonly (readonly RankedItem[])[],
  options: FuseOptions = {},
): FusedItem[] {
  const k = options.k ?? DEFAULT_K;
  const scores = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  let order = 0;

  for (const list of lists) {
    list.forEach((item, index) => {
      const rank = index + 1; // 1-based rank
      scores.set(item.chunkId, (scores.get(item.chunkId) ?? 0) + 1 / (k + rank));
      if (!firstSeen.has(item.chunkId)) {
        firstSeen.set(item.chunkId, order);
        order += 1;
      }
    });
  }

  return [...scores.entries()]
    .map(([chunkId, score]) => ({ chunkId, score }))
    // Descending fused score; ties broken by first-seen order for a stable, deterministic result.
    .sort(
      (a, b) =>
        b.score - a.score ||
        (firstSeen.get(a.chunkId) ?? 0) - (firstSeen.get(b.chunkId) ?? 0),
    );
}
