import { describe, it, expect } from "vitest";
import { buildApp } from "../src/app.js";
import { ReadinessRegistry } from "../src/readiness/registry.js";

describe("GET /ready", () => {
  it("with an empty registry → 200 { status: 'ready', checks: [] }", async () => {
    const app = buildApp({ logger: false, readiness: new ReadinessRegistry() });
    const res = await app.inject({ method: "GET", url: "/ready" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ready", checks: [] });

    await app.close();
  });

  it("with a passing check → 200 ready, the check reported ok", async () => {
    const reg = new ReadinessRegistry();
    reg.register("redis", () => true);
    const app = buildApp({ logger: false, readiness: reg });

    const res = await app.inject({ method: "GET", url: "/ready" });
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.status).toBe("ready");
    expect(body.checks).toContainEqual({ name: "redis", status: "ok" });

    await app.close();
  });

  it("with a throwing check → 503 not_ready, error reported, no internal leak", async () => {
    const reg = new ReadinessRegistry();
    reg.register("openemr", () => {
      throw new Error("secret internal detail: connection refused at 10.0.0.5");
    });
    const app = buildApp({ logger: false, readiness: reg });

    const res = await app.inject({ method: "GET", url: "/ready" });
    const body = res.json();

    expect(res.statusCode).toBe(503);
    expect(body.status).toBe("not_ready");
    expect(body.checks).toContainEqual({ name: "openemr", status: "error" });
    expect(res.payload).not.toContain("secret internal detail");

    await app.close();
  });

  it("with a check returning false → 503 not_ready", async () => {
    const reg = new ReadinessRegistry();
    reg.register("langfuse", () => false);
    const app = buildApp({ logger: false, readiness: reg });

    const res = await app.inject({ method: "GET", url: "/ready" });

    expect(res.statusCode).toBe(503);
    expect(res.json().status).toBe("not_ready");

    await app.close();
  });

  it("with a failing NON-critical check → 200 degraded (service still up)", async () => {
    const reg = new ReadinessRegistry();
    reg.register("redis", () => true);
    reg.register("cohere", () => false, { critical: false });
    const app = buildApp({ logger: false, readiness: reg });

    const res = await app.inject({ method: "GET", url: "/ready" });
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.checks).toContainEqual({ name: "cohere", status: "error" });
    expect(body.checks).toContainEqual({ name: "redis", status: "ok" });

    await app.close();
  });
});
