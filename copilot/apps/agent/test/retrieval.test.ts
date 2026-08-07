import { describe, it, expect } from "vitest";
import { createMetricsRegistry } from "@copilot/metrics";
import type { EvidenceSnippet } from "@copilot/rag";
import { runRetrieval } from "../src/agent/retrieval.js";

function snippet(id: string): EvidenceSnippet {
  return { chunkId: id, doc: "guide", section: "S", text: `text ${id}`, score: 0.5 };
}

describe("runRetrieval — W2 retrieval signals", () => {
  it("records hits + rerank used on a reranked query", async () => {
    const metrics = createMetricsRegistry();
    const out = await runRetrieval(
      "q",
      {
        fusedRetrieve: async () => [snippet("a"), snippet("b"), snippet("c")],
        rerank: async () => ({ snippets: [snippet("a"), snippet("b")], reranked: true }),
      },
      metrics,
    );

    expect(out.evidence.map((e) => e.chunkId)).toEqual(["a", "b"]);
    expect(out.rerank).toBe("used");
    const s = metrics.snapshot();
    expect(s.retrieval.queriesTotal).toBe(1);
    expect(s.retrieval.snippetsTotal).toBe(2);
    expect(s.retrieval.rerankUsed).toBe(1);
    expect(s.retrieval.latencyMs.p50).not.toBeNull();
  });

  it("records rerank degraded when the reranker fell back to the fused order", async () => {
    const metrics = createMetricsRegistry();
    const out = await runRetrieval(
      "q",
      {
        fusedRetrieve: async () => [snippet("a"), snippet("b")],
        rerank: async () => ({ snippets: [snippet("a"), snippet("b")], reranked: false }),
      },
      metrics,
    );

    expect(out.rerank).toBe("degraded");
    expect(metrics.snapshot().retrieval.rerankDegraded).toBe(1);
    expect(metrics.snapshot().retrieval.rerankUsed).toBe(0);
  });

  it("records a zero-hit query as a miss", async () => {
    const metrics = createMetricsRegistry();
    const out = await runRetrieval(
      "q",
      { fusedRetrieve: async () => [], rerank: async () => ({ snippets: [], reranked: false }) },
      metrics,
    );

    expect(out.evidence).toEqual([]);
    expect(metrics.snapshot().retrieval.zeroHitQueries).toBe(1);
  });
});
