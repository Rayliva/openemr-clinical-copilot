import { describe, it, expect } from "vitest";
import { rerankEvidence, type RerankFn } from "../src/rerank.js";
import type { EvidenceSnippet } from "../src/contracts.js";

function snip(chunkId: string, text: string, score = 0.03): EvidenceSnippet {
  return { chunkId, doc: "d", section: chunkId, text, score };
}

const fused: EvidenceSnippet[] = [
  snip("a", "alpha about statins"),
  snip("b", "beta about metformin and kidney"),
  snip("c", "gamma about blood pressure"),
];

describe("rerankEvidence — reorder by a reranker, degrade on failure", () => {
  it("reorders to the reranker's ranking and applies its relevance scores", async () => {
    // reranker says candidate index 1 (b) is most relevant, then 0 (a)
    const reranker: RerankFn = async () => [
      { index: 1, relevanceScore: 0.98 },
      { index: 0, relevanceScore: 0.42 },
      { index: 2, relevanceScore: 0.11 },
    ];
    const out = await rerankEvidence("metformin kidney", fused, reranker, { topN: 2 });
    expect(out.reranked).toBe(true);
    expect(out.snippets.map((s) => s.chunkId)).toEqual(["b", "a"]);
    expect(out.snippets[0]?.score).toBe(0.98);
  });

  it("falls back to the fused order (labeled unreranked) when the reranker throws — never hangs the turn", async () => {
    const reranker: RerankFn = async () => {
      throw new Error("rerank service down");
    };
    const out = await rerankEvidence("q", fused, reranker, { topN: 2 });
    expect(out.reranked).toBe(false);
    expect(out.snippets.map((s) => s.chunkId)).toEqual(["a", "b"]); // original fused order, top 2
  });

  it("falls back when the reranker returns nothing usable", async () => {
    const reranker: RerankFn = async () => [];
    const out = await rerankEvidence("q", fused, reranker, { topN: 3 });
    expect(out.reranked).toBe(false);
    expect(out.snippets).toHaveLength(3);
  });

  it("ignores out-of-range indices from the reranker (never a wrong/blank citation)", async () => {
    const reranker: RerankFn = async () => [
      { index: 99, relevanceScore: 0.9 }, // invalid
      { index: 2, relevanceScore: 0.5 },
    ];
    const out = await rerankEvidence("q", fused, reranker, { topN: 3 });
    expect(out.reranked).toBe(true);
    expect(out.snippets.map((s) => s.chunkId)).toEqual(["c"]);
  });

  it("empty candidates → empty, no throw", async () => {
    const reranker: RerankFn = async () => [];
    expect(await rerankEvidence("q", [], reranker)).toEqual({ snippets: [], reranked: false });
  });
});
