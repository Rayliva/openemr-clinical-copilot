import { describe, it, expect } from "vitest";
import { createMetricsRegistry } from "@copilot/metrics";
import { buildApp } from "../src/app.js";

/** Spec: docs/specs/observability-dashboard.md (AC7, AC8, AC9). */

const TOKEN = "metrics-secret";

function appWithMetrics() {
  const metrics = createMetricsRegistry();
  metrics.recordTurn({ latencyMs: 100, failed: false, verdictOk: true });
  metrics.recordTurn({ latencyMs: 300, failed: true, verdictOk: false });
  metrics.recordToolCall({ tool: "medications", latencyMs: 20, failed: true });
  const app = buildApp({ logger: false, metrics, metricsToken: TOKEN });
  return { app, metrics };
}

const auth = { authorization: `Bearer ${TOKEN}` };

describe("GET /metrics", () => {
  it("rejects a request with no bearer token and leaks no values (AC7)", async () => {
    const { app } = appWithMetrics();
    const res = await app.inject({ method: "GET", url: "/metrics" });

    expect(res.statusCode).toBe(401);
    expect(res.body).not.toContain("requestsTotal");
    await app.close();
  });

  it("rejects a wrong bearer token", async () => {
    const { app } = appWithMetrics();
    const res = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: { authorization: "Bearer wrong" },
    });

    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("returns the snapshot with a valid token", async () => {
    const { app } = appWithMetrics();
    const res = await app.inject({ method: "GET", url: "/metrics", headers: auth });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.requestsTotal).toBe(2);
    expect(body.errorRate).toBe(0.5);
    expect(body.latencyMs.p50).toBe(100);
    expect(body.tools.medications.failuresTotal).toBe(1);
    expect(body.verificationPassTotal).toBe(1);
    expect(body.verificationFailTotal).toBe(1);
    expect(body.retriesTotal).toBe(0);
    expect(body.retryPathImplemented).toBe(true);
    await app.close();
  });

  it("carries no PHI (AC8)", async () => {
    const { app } = appWithMetrics();
    const res = await app.inject({ method: "GET", url: "/metrics", headers: auth });

    const body = res.body.toLowerCase();
    for (const forbidden of ["pid", "correlationid", "patient", "uuid"]) {
      expect(body).not.toContain(forbidden);
    }
    await app.close();
  });

  it("accepts the token as a ?token= query param (browser view convenience)", async () => {
    const { app } = appWithMetrics();
    const res = await app.inject({ method: "GET", url: `/dashboard?token=${TOKEN}` });

    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("rejects a wrong ?token= query param", async () => {
    const { app } = appWithMetrics();
    const res = await app.inject({ method: "GET", url: "/dashboard?token=nope" });

    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("does not leak its auth hook onto other routes", async () => {
    const { app } = appWithMetrics();
    // /health must stay unauthenticated even though the metrics plugin added a hook.
    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("rejects a token smuggled past the path check via a query string", async () => {
    const { app } = appWithMetrics();
    const res = await app.inject({ method: "GET", url: "/metrics?bypass=1" });

    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("is not registered at all when no metrics token is configured", async () => {
    const app = buildApp({ logger: false, metrics: createMetricsRegistry() });
    const res = await app.inject({ method: "GET", url: "/metrics", headers: auth });

    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe("GET /dashboard", () => {
  it("requires the bearer token", async () => {
    const { app } = appWithMetrics();
    const res = await app.inject({ method: "GET", url: "/dashboard" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("renders every E4 metric (AC9)", async () => {
    const { app } = appWithMetrics();
    const res = await app.inject({ method: "GET", url: "/dashboard", headers: auth });

    expect(res.statusCode).toBe(200);
    const html = res.body;
    for (const label of [
      "Requests",
      "Error rate",
      "p50",
      "p95",
      "Verification",
      "Retries",
      "medications",
    ]) {
      expect(html).toContain(label);
    }
    await app.close();
  });

  it("no longer shows the 'no retry path' note now that the retry path is implemented", async () => {
    const { app } = appWithMetrics();
    const res = await app.inject({ method: "GET", url: "/dashboard", headers: auth });

    // The bounded regenerate loop exists; the old disclaimer must be gone so the
    // dashboard does not contradict `retryPathImplemented: true`.
    expect(res.body.toLowerCase()).not.toContain("no retry path");
    await app.close();
  });

  it("renders the W2 sections (ingestion, retrieval, supervisor) with recorded signals", async () => {
    const metrics = createMetricsRegistry();
    metrics.recordIngestion({ docType: "lab_pdf", outcome: "ok", fieldsLocated: 3, fieldsForcedReview: 1, latencyMs: 8000 });
    metrics.recordRetrieval({ snippets: 3, rerank: "used", latencyMs: 400 });
    metrics.recordRouting({ target: "evidence_retriever", terminal: false, hopCapped: false });
    metrics.recordRouting({ target: "ready", terminal: true, hopCapped: false });
    const app = buildApp({ logger: false, metrics, metricsToken: TOKEN });

    const res = await app.inject({ method: "GET", url: "/dashboard", headers: auth });
    expect(res.statusCode).toBe(200);
    const html = res.body;
    for (const label of ["Documents", "lab_pdf", "Located", "Retrieval", "Rerank", "Supervisor", "evidence_retriever", "N/A"]) {
      expect(html).toContain(label);
    }
    // Still PHI-free.
    expect(html.toLowerCase()).not.toContain("patient");
    await app.close();
  });
});
