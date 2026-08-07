import { describe, it, expect } from "vitest";
import { createMetricsRegistry } from "@copilot/metrics";
import { buildApp } from "../src/app.js";

/** Spec: docs/specs/alerts-and-oncall.md (AC8-9). */

const TOKEN = "metrics-secret";
const auth = { authorization: `Bearer ${TOKEN}` };

/** A registry driven into an all-tools-failing, high-error state (the E9 cliff). */
function firingRegistry() {
  const metrics = createMetricsRegistry();
  for (let i = 0; i < 30; i += 1) {
    metrics.recordTurn({ latencyMs: 31000, failed: true, verdictOk: false });
    metrics.recordToolCall({ tool: "medications", latencyMs: 100, failed: true });
  }
  return metrics;
}

function healthyRegistry() {
  const metrics = createMetricsRegistry();
  for (let i = 0; i < 30; i += 1) {
    metrics.recordTurn({ latencyMs: 5000, failed: false, verdictOk: true });
    metrics.recordToolCall({ tool: "medications", latencyMs: 100, failed: false });
  }
  return metrics;
}

describe("GET /alerts", () => {
  it("requires the bearer token (AC8)", async () => {
    const app = buildApp({ logger: false, metrics: firingRegistry(), metricsToken: TOKEN });
    const res = await app.inject({ method: "GET", url: "/alerts" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("returns firing status with the active alerts, no PHI (AC8)", async () => {
    const app = buildApp({ logger: false, metrics: firingRegistry(), metricsToken: TOKEN });
    const res = await app.inject({ method: "GET", url: "/alerts", headers: auth });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("firing");
    // `alerts` lists EVERY rule by name (discoverable in any state); `firing` is the active subset.
    const names = body.alerts.map((a: { name: string }) => a.name);
    expect(names).toContain("high_error_rate");
    expect(names).toContain("high_latency_p95");
    expect(names).toContain("tool_failure_rate");
    // The W2 rules the rubric names — discoverable by name.
    expect(names).toContain("extraction_failure_rate");
    expect(names).toContain("rag_retrieval_latency");
    expect(names).toContain("eval_regression_detection");
    const firingNames = body.firing.map((a: { name: string }) => a.name);
    expect(firingNames).toContain("high_error_rate");
    // No PHI anywhere in the payload.
    const raw = res.body.toLowerCase();
    for (const forbidden of ["pid", "correlationid", "patient", "uuid"]) {
      expect(raw).not.toContain(forbidden);
    }
    await app.close();
  });

  it("returns ok with no alerts on a healthy registry", async () => {
    const app = buildApp({ logger: false, metrics: healthyRegistry(), metricsToken: TOKEN });
    const res = await app.inject({ method: "GET", url: "/alerts", headers: auth });

    const body = res.json();
    expect(body.status).toBe("ok");
    // `firing` is empty when healthy; `alerts` still lists every defined rule by name.
    expect(body.firing).toEqual([]);
    const names = body.alerts.map((a: { name: string }) => a.name);
    expect(names).toContain("eval_regression_detection");
    expect(names).toContain("rag_retrieval_latency");
    await app.close();
  });

  it("logs a structured line naming a firing rule (AC9)", async () => {
    const lines: string[] = [];
    const stream = { write: (s: string) => lines.push(s) };
    const app = buildApp({
      logger: { level: "warn", stream },
      metrics: firingRegistry(),
      metricsToken: TOKEN,
    });
    await app.inject({ method: "GET", url: "/alerts", headers: auth });
    await app.close();

    const joined = lines.join("\n");
    expect(joined).toContain("high_error_rate");
    // Structured: the rule's value + threshold ride as fields, not interpolated prose.
    const alertLine = lines.find((l) => l.includes("alert firing"));
    expect(alertLine).toBeDefined();
    const parsed = JSON.parse(alertLine as string);
    expect(parsed.alert).toBe("high_error_rate");
    expect(typeof parsed.value).toBe("number");
    expect(typeof parsed.threshold).toBe("number");
  });
});
