import { describe, it, expect, vi } from "vitest";
import { createOpenEmrReadinessCheck } from "../src/openemr/readiness.js";

const BASE = "http://openemr.test";

describe("createOpenEmrReadinessCheck", () => {
  it("is ok when the capability probe responds 2xx", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 200 }));
    const check = createOpenEmrReadinessCheck({ baseUrl: BASE, fetchFn });

    await expect(check()).resolves.toBe(true);
    expect(fetchFn).toHaveBeenCalledWith(
      `${BASE}/oauth2/default/.well-known/openid-configuration`,
      expect.anything(),
    );
  });

  it("is not ok when the probe responds non-2xx", async () => {
    const fetchFn = vi.fn(async () => new Response("err", { status: 500 }));
    const check = createOpenEmrReadinessCheck({ baseUrl: BASE, fetchFn });

    await expect(check()).resolves.toBe(false);
  });

  it("propagates a network error (registry reports it as error)", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const check = createOpenEmrReadinessCheck({ baseUrl: BASE, fetchFn });

    await expect(check()).rejects.toThrow();
  });

  it("rejects when the probe exceeds the timeout", async () => {
    const fetchFn = vi.fn(
      () => new Promise<Response>((resolve) => setTimeout(() => resolve(new Response("{}")), 100)),
    );
    const check = createOpenEmrReadinessCheck({ baseUrl: BASE, fetchFn, timeoutMs: 5 });

    await expect(check()).rejects.toThrow(/timed out/);
  });
});
