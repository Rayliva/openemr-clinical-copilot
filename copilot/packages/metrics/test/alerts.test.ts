import { describe, expect, it } from "vitest";
import { evaluateAlerts } from "../src/alerts.js";
import type { MetricsSnapshot } from "../src/registry.js";

/** Spec: docs/specs/alerts-and-oncall.md (AC1-7). Thresholds grounded in E9. */

const HEALTHY: MetricsSnapshot = {
  requestsTotal: 100,
  requestsFailed: 0,
  errorRate: 0,
  latencyMs: { p50: 5000, p95: 9000 },
  tools: {
    demographics: { callsTotal: 100, failuresTotal: 0, latencyMs: { p50: 2000, p95: 3000 } },
  },
  verificationPassTotal: 100,
  verificationFailTotal: 0,
  retriesTotal: 0,
  retryPathImplemented: true,
  windowSize: 1000,
  // W2 traffic present and healthy: enough volume to clear the gates, no failures.
  ingestion: {
    documentsTotal: 20,
    byDocType: { lab_pdf: { total: 20, ok: 20, degraded: 0 } },
    extractionOk: 20,
    extractionDegraded: 0,
    fieldsLocated: 60,
    fieldsForcedReview: 4,
    extractionLatencyMs: { p50: 8000, p95: 15000 },
  },
  retrieval: {
    queriesTotal: 50,
    snippetsTotal: 150,
    zeroHitQueries: 2,
    rerankUsed: 50,
    rerankDegraded: 0,
    latencyMs: { p50: 400, p95: 900 },
  },
  supervisor: {
    routes: { evidence_retriever: 30, intake_extractor: 5, ready: 50 },
    turnsRouted: 50,
    hopCapHits: 0,
  },
  eval: {
    categories: {
      schema_valid: { pass: 100, total: 100 },
      citation_present: { pass: 100, total: 100 },
      grounding_ok: { pass: 99, total: 100 },
      no_phi_in_logs: { pass: 100, total: 100 },
    },
    sampled: 100,
  },
};

function withOverrides(patch: Partial<MetricsSnapshot>): MetricsSnapshot {
  return { ...HEALTHY, ...patch };
}

function outcome(snapshot: MetricsSnapshot, name: string) {
  return evaluateAlerts(snapshot).find((o) => o.name === name);
}

describe("evaluateAlerts", () => {
  describe("high_error_rate (AC1-3)", () => {
    it("fires critical at a 0.6 error rate with enough volume", () => {
      const o = outcome(withOverrides({ requestsTotal: 100, requestsFailed: 60, errorRate: 0.6 }), "high_error_rate");
      expect(o?.status).toBe("critical");
    });

    it("fires warning at 0.15 and stays ok at 0.05", () => {
      expect(outcome(withOverrides({ errorRate: 0.15 }), "high_error_rate")?.status).toBe("warning");
      expect(outcome(withOverrides({ errorRate: 0.05 }), "high_error_rate")?.status).toBe("ok");
    });

    it("reports insufficient_data below the volume gate, and does not fire", () => {
      const snap = withOverrides({ requestsTotal: 3, requestsFailed: 2, errorRate: 0.6667 });
      const o = outcome(snap, "high_error_rate");
      expect(o?.status).toBe("insufficient_data");
      const firing = evaluateAlerts(snap).filter((a) => a.status === "warning" || a.status === "critical");
      expect(firing.map((a) => a.name)).not.toContain("high_error_rate");
    });
  });

  describe("high_latency_p95 (AC4)", () => {
    it("maps p95 to severity bands", () => {
      expect(outcome(withOverrides({ latencyMs: { p50: 1, p95: 31000 } }), "high_latency_p95")?.status).toBe("critical");
      expect(outcome(withOverrides({ latencyMs: { p50: 1, p95: 16000 } }), "high_latency_p95")?.status).toBe("warning");
      expect(outcome(withOverrides({ latencyMs: { p50: 1, p95: 9000 } }), "high_latency_p95")?.status).toBe("ok");
    });

    it("is insufficient_data when there is no p95", () => {
      expect(outcome(withOverrides({ latencyMs: { p50: null, p95: null } }), "high_latency_p95")?.status).toBe(
        "insufficient_data",
      );
    });
  });

  describe("tool_failure_rate (AC5)", () => {
    it("fires critical on the worst tool and names it", () => {
      const snap = withOverrides({
        tools: {
          demographics: { callsTotal: 100, failuresTotal: 0, latencyMs: { p50: 1, p95: 1 } },
          medications: { callsTotal: 4, failuresTotal: 4, latencyMs: { p50: 1, p95: 1 } },
        },
      });
      const o = outcome(snap, "tool_failure_rate");
      expect(o?.status).toBe("critical");
      expect(o?.description).toContain("medications");
    });
  });

  describe("verification_fail_rate (AC6)", () => {
    it("fires critical when most turns fail verification", () => {
      const snap = withOverrides({ verificationPassTotal: 10, verificationFailTotal: 30 });
      expect(outcome(snap, "verification_fail_rate")?.status).toBe("critical");
    });
  });

  describe("healthy snapshot (AC7)", () => {
    it("returns every rule ok and nothing firing", () => {
      const outcomes = evaluateAlerts(HEALTHY);
      expect(outcomes.length).toBeGreaterThanOrEqual(4);
      expect(outcomes.every((o) => o.status === "ok")).toBe(true);
      expect(outcomes.filter((o) => o.status === "warning" || o.status === "critical")).toEqual([]);
    });
  });

  // W2 rules — docs/specs/w2-observability.md §2.
  describe("extraction_failure_rate (W2)", () => {
    it("fires critical when most extractions degrade", () => {
      const snap = withOverrides({
        ingestion: { ...HEALTHY.ingestion, extractionOk: 0, extractionDegraded: 6 },
      });
      expect(outcome(snap, "extraction_failure_rate")?.status).toBe("critical");
    });

    it("fires warning at ~0.3 degraded", () => {
      const snap = withOverrides({
        ingestion: { ...HEALTHY.ingestion, extractionOk: 14, extractionDegraded: 6 },
      });
      expect(outcome(snap, "extraction_failure_rate")?.status).toBe("warning");
    });

    it("is insufficient_data below the extraction-volume gate", () => {
      const snap = withOverrides({
        ingestion: { ...HEALTHY.ingestion, extractionOk: 1, extractionDegraded: 2 },
      });
      expect(outcome(snap, "extraction_failure_rate")?.status).toBe("insufficient_data");
    });
  });

  describe("rag_retrieval_latency (W2)", () => {
    it("maps retrieval p95 to severity bands", () => {
      expect(
        outcome(withOverrides({ retrieval: { ...HEALTHY.retrieval, latencyMs: { p50: 1, p95: 9000 } } }), "rag_retrieval_latency")?.status,
      ).toBe("critical");
      expect(
        outcome(withOverrides({ retrieval: { ...HEALTHY.retrieval, latencyMs: { p50: 1, p95: 5000 } } }), "rag_retrieval_latency")?.status,
      ).toBe("warning");
      expect(
        outcome(withOverrides({ retrieval: { ...HEALTHY.retrieval, latencyMs: { p50: 1, p95: 900 } } }), "rag_retrieval_latency")?.status,
      ).toBe("ok");
    });

    it("is insufficient_data when there is no retrieval p95", () => {
      const snap = withOverrides({ retrieval: { ...HEALTHY.retrieval, latencyMs: { p50: null, p95: null } } });
      expect(outcome(snap, "rag_retrieval_latency")?.status).toBe("insufficient_data");
    });
  });

  describe("eval_regression_detection (W2)", () => {
    it("is ok when every category's failure rate is within 5%", () => {
      expect(outcome(HEALTHY, "eval_regression_detection")?.status).toBe("ok");
    });

    it("fires warning when a category drops >5% (a >5% failure rate)", () => {
      const snap = withOverrides({
        eval: { sampled: 100, categories: { ...HEALTHY.eval.categories, citation_present: { pass: 92, total: 100 } } },
      });
      expect(outcome(snap, "eval_regression_detection")?.status).toBe("warning");
    });

    it("fires critical when a category drops >10%", () => {
      const snap = withOverrides({
        eval: { sampled: 100, categories: { ...HEALTHY.eval.categories, schema_valid: { pass: 80, total: 100 } } },
      });
      expect(outcome(snap, "eval_regression_detection")?.status).toBe("critical");
    });

    it("is insufficient_data below the per-category sample gate", () => {
      const snap = withOverrides({
        eval: { sampled: 4, categories: { citation_present: { pass: 2, total: 4 } } },
      });
      expect(outcome(snap, "eval_regression_detection")?.status).toBe("insufficient_data");
    });

    it("is always present by name in the evaluated set (discoverable even when ok)", () => {
      const names = evaluateAlerts(HEALTHY).map((o) => o.name);
      expect(names).toContain("eval_regression_detection");
      expect(names).toContain("extraction_failure_rate");
      expect(names).toContain("rag_retrieval_latency");
    });
  });

  describe("supervisor_hop_cap_rate (W2)", () => {
    it("fires critical when the hop cap fires often", () => {
      const snap = withOverrides({
        supervisor: { ...HEALTHY.supervisor, turnsRouted: 20, hopCapHits: 12 },
      });
      expect(outcome(snap, "supervisor_hop_cap_rate")?.status).toBe("critical");
    });

    it("is insufficient_data below the routed-turn gate", () => {
      const snap = withOverrides({
        supervisor: { ...HEALTHY.supervisor, turnsRouted: 3, hopCapHits: 2 },
      });
      expect(outcome(snap, "supervisor_hop_cap_rate")?.status).toBe("insufficient_data");
    });
  });
});
