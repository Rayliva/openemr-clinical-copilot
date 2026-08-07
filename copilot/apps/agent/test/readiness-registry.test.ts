import { describe, it, expect } from "vitest";
import { ReadinessRegistry } from "../src/readiness/registry.js";

/**
 * W2: the registry gains a per-check `critical` flag and a three-state status.
 * Spec: docs/specs/w2-observability.md §4.
 */
describe("ReadinessRegistry — degraded status (W2)", () => {
  it("is ready when every check passes", async () => {
    const reg = new ReadinessRegistry().register("redis", () => true);
    const report = await reg.runAll();
    expect(report.status).toBe("ready");
    expect(report.ready).toBe(true);
  });

  it("is not_ready when a critical check fails", async () => {
    const reg = new ReadinessRegistry().register("openemr", () => false);
    const report = await reg.runAll();
    expect(report.status).toBe("not_ready");
    expect(report.ready).toBe(false);
  });

  it("is degraded (not not_ready) when only a non-critical check fails", async () => {
    const reg = new ReadinessRegistry()
      .register("redis", () => true)
      .register("cohere", () => false, { critical: false });
    const report = await reg.runAll();

    expect(report.status).toBe("degraded");
    // Degraded is still "up" — the binary `ready` stays true so a load balancer keeps routing.
    expect(report.ready).toBe(true);
    expect(report.checks).toContainEqual({ name: "cohere", status: "error" });
  });

  it("is not_ready when both a critical and a non-critical check fail (critical wins)", async () => {
    const reg = new ReadinessRegistry()
      .register("redis", () => false)
      .register("cohere", () => false, { critical: false });
    expect((await reg.runAll()).status).toBe("not_ready");
  });

  it("still reports each check as {name,status} only (no critical flag leaks out)", async () => {
    const reg = new ReadinessRegistry().register("cohere", () => true, { critical: false });
    const report = await reg.runAll();
    expect(report.checks).toEqual([{ name: "cohere", status: "ok" }]);
  });
});
