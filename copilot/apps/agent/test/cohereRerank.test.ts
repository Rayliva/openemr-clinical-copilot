import { describe, it, expect } from "vitest";
import { createCohereRerank } from "../src/cohere/cohereRerank.js";

function fakeFetch(response: { status?: number; body?: unknown }): {
  fetchFn: typeof fetch;
  calls: { url: string; init: RequestInit }[];
} {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return {
      ok: (response.status ?? 200) < 400,
      status: response.status ?? 200,
      json: async () => response.body ?? {},
    } as Response;
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

describe("createCohereRerank", () => {
  it("posts query + documents and maps results to {index, relevanceScore}", async () => {
    const { fetchFn, calls } = fakeFetch({
      body: { results: [{ index: 2, relevance_score: 0.9 }, { index: 0, relevance_score: 0.3 }] },
    });
    const rerank = createCohereRerank({ apiKey: "k", fetchFn });
    const out = await rerank("q", ["d0", "d1", "d2"]);
    expect(out).toEqual([
      { index: 2, relevanceScore: 0.9 },
      { index: 0, relevanceScore: 0.3 },
    ]);
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body.query).toBe("q");
    expect(body.documents).toEqual(["d0", "d1", "d2"]);
    expect(body.model).toMatch(/rerank/);
  });

  it("short-circuits empty documents without a network call", async () => {
    const { fetchFn, calls } = fakeFetch({ body: {} });
    const rerank = createCohereRerank({ apiKey: "k", fetchFn });
    expect(await rerank("q", [])).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("throws a PHI-free error on a non-ok response (never echoes the query)", async () => {
    const { fetchFn } = fakeFetch({ status: 500 });
    const rerank = createCohereRerank({ apiKey: "k", fetchFn });
    await expect(rerank("patient-specific query", ["d"])).rejects.toThrow(/500/);
    await expect(rerank("patient-specific query", ["d"])).rejects.not.toThrow(/patient-specific/);
  });
});
