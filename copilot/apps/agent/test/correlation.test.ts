import { describe, it, expect } from "vitest";
import { buildApp } from "../src/app.js";

describe("correlation id", () => {
  it("generates a correlation id when none is supplied and returns it", async () => {
    const app = buildApp({ logger: false });
    const res = await app.inject({ method: "GET", url: "/health" });

    const cid = res.headers["x-correlation-id"];
    expect(cid).toBeTruthy();
    expect(typeof cid).toBe("string");

    await app.close();
  });

  it("echoes an inbound correlation id unchanged", async () => {
    const app = buildApp({ logger: false });
    const res = await app.inject({
      method: "GET",
      url: "/health",
      headers: { "x-correlation-id": "test-corr-123" },
    });

    expect(res.headers["x-correlation-id"]).toBe("test-corr-123");

    await app.close();
  });
});
