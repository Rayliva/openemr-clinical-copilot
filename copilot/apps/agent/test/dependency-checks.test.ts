import { describe, it, expect, vi } from "vitest";
import { createHttpReadinessCheck } from "../src/readiness/httpCheck.js";
import { createLangfuseReadinessCheck } from "../src/langfuse/readiness.js";
import { createAnthropicReadinessCheck } from "../src/anthropic/readiness.js";
import { createCohereReadinessCheck } from "../src/cohere/readiness.js";

const ok = () => new Response("{}", { status: 200 });
const bad = () => new Response("no", { status: 503 });

describe("createHttpReadinessCheck", () => {
  it("is ok on 2xx", async () => {
    const check = createHttpReadinessCheck({ url: "http://x/health", fetchFn: async () => ok() });
    await expect(check()).resolves.toBe(true);
  });
  it("is not ok on non-2xx", async () => {
    const check = createHttpReadinessCheck({ url: "http://x/health", fetchFn: async () => bad() });
    await expect(check()).resolves.toBe(false);
  });
  it("propagates a network error", async () => {
    const check = createHttpReadinessCheck({
      url: "http://x/health",
      fetchFn: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    await expect(check()).rejects.toThrow();
  });
  it("rejects on timeout", async () => {
    const check = createHttpReadinessCheck({
      url: "http://x/health",
      timeoutMs: 5,
      fetchFn: () => new Promise((r) => setTimeout(() => r(ok()), 100)),
    });
    await expect(check()).rejects.toThrow(/timed out/);
  });
});

describe("createLangfuseReadinessCheck", () => {
  it("probes the Langfuse public health endpoint", async () => {
    const fetchFn = vi.fn(async () => ok());
    const check = createLangfuseReadinessCheck({ baseUrl: "http://lf:3000/", fetchFn });
    await expect(check()).resolves.toBe(true);
    expect(fetchFn.mock.calls[0]![0]).toBe("http://lf:3000/api/public/health");
  });
});

describe("createAnthropicReadinessCheck", () => {
  it("probes /v1/models with the api key header", async () => {
    const fetchFn = vi.fn(async () => ok());
    const check = createAnthropicReadinessCheck({ apiKey: "sk-test", fetchFn });
    await expect(check()).resolves.toBe(true);

    const call = fetchFn.mock.calls[0]!;
    expect(call[0]).toBe("https://api.anthropic.com/v1/models");
    const headers = new Headers(call[1]!.headers);
    expect(headers.get("x-api-key")).toBe("sk-test");
    expect(headers.get("anthropic-version")).toBe("2023-06-01");
  });
});

describe("createCohereReadinessCheck", () => {
  it("probes /v1/models with the bearer api key", async () => {
    const fetchFn = vi.fn(async () => ok());
    const check = createCohereReadinessCheck({ apiKey: "co-test", fetchFn });
    await expect(check()).resolves.toBe(true);

    const call = fetchFn.mock.calls[0]!;
    expect(call[0]).toBe("https://api.cohere.com/v1/models");
    const headers = new Headers(call[1]!.headers);
    expect(headers.get("authorization")).toBe("Bearer co-test");
  });

  it("is not ok when Cohere rejects the key", async () => {
    const check = createCohereReadinessCheck({ apiKey: "bad", fetchFn: async () => bad() });
    await expect(check()).resolves.toBe(false);
  });
});
