import { describe, it, expect } from "vitest";
import { createCohereEmbed } from "../src/cohere/cohereEmbed.js";

/** A fake fetch capturing the request and returning a canned Cohere embed response. */
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

describe("createCohereEmbed", () => {
  it("posts model + input_type + texts and returns the float embeddings", async () => {
    const { fetchFn, calls } = fakeFetch({ body: { embeddings: { float: [[0.1, 0.2], [0.3, 0.4]] } } });
    const embed = createCohereEmbed({ apiKey: "k", inputType: "search_document", fetchFn });

    const out = await embed(["metformin", "statin"]);
    expect(out).toEqual([[0.1, 0.2], [0.3, 0.4]]);

    expect(calls).toHaveLength(1);
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body.input_type).toBe("search_document");
    expect(body.texts).toEqual(["metformin", "statin"]);
    expect(body.model).toContain("embed");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer k");
  });

  it("short-circuits empty input without a network call", async () => {
    const { fetchFn, calls } = fakeFetch({ body: {} });
    const embed = createCohereEmbed({ apiKey: "k", inputType: "search_query", fetchFn });
    expect(await embed([])).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("throws a PHI-free error on a non-ok response (status only, no echoed text)", async () => {
    const { fetchFn } = fakeFetch({ status: 429 });
    const embed = createCohereEmbed({ apiKey: "k", inputType: "search_query", fetchFn });
    await expect(embed(["a query with patient specifics"])).rejects.toThrow(/429/);
    await expect(embed(["a query with patient specifics"])).rejects.not.toThrow(/patient specifics/);
  });

  it("throws when the response is missing embeddings.float", async () => {
    const { fetchFn } = fakeFetch({ body: { id: "x" } });
    const embed = createCohereEmbed({ apiKey: "k", inputType: "search_document", fetchFn });
    await expect(embed(["x"])).rejects.toThrow();
  });
});
