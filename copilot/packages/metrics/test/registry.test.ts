import { describe, expect, it } from "vitest";
import { createMetricsRegistry } from "../src/registry.js";

/**
 * Acceptance criteria from docs/specs/observability-dashboard.md.
 * Behavior only — the snapshot is the observable surface, never internals.
 */
describe("MetricsRegistry", () => {
  describe("request counts and error rate (AC1)", () => {
    it("reports 3 successes and 1 failure as a 0.25 error rate", () => {
      const registry = createMetricsRegistry();

      registry.recordTurn({ latencyMs: 10, failed: false, verdictOk: true });
      registry.recordTurn({ latencyMs: 10, failed: false, verdictOk: true });
      registry.recordTurn({ latencyMs: 10, failed: false, verdictOk: true });
      registry.recordTurn({ latencyMs: 10, failed: true, verdictOk: false });

      const snapshot = registry.snapshot();
      expect(snapshot.requestsTotal).toBe(4);
      expect(snapshot.requestsFailed).toBe(1);
      expect(snapshot.errorRate).toBe(0.25);
    });

    it("reports a zero error rate rather than NaN when no turns were recorded", () => {
      const snapshot = createMetricsRegistry().snapshot();
      expect(snapshot.requestsTotal).toBe(0);
      expect(snapshot.errorRate).toBe(0);
    });
  });

  describe("latency percentiles (AC2)", () => {
    it("computes nearest-rank p50 and p95 over the observations", () => {
      const registry = createMetricsRegistry();
      for (const latencyMs of [100, 200, 300, 400]) {
        registry.recordTurn({ latencyMs, failed: false, verdictOk: true });
      }

      const snapshot = registry.snapshot();
      expect(snapshot.latencyMs.p50).toBe(200);
      expect(snapshot.latencyMs.p95).toBe(400);
    });

    it("is order-independent", () => {
      const registry = createMetricsRegistry();
      for (const latencyMs of [400, 100, 300, 200]) {
        registry.recordTurn({ latencyMs, failed: false, verdictOk: true });
      }
      expect(registry.snapshot().latencyMs.p50).toBe(200);
    });

    it("reports null percentiles when there is nothing to measure", () => {
      const snapshot = createMetricsRegistry().snapshot();
      expect(snapshot.latencyMs.p50).toBeNull();
      expect(snapshot.latencyMs.p95).toBeNull();
    });
  });

  describe("per-tool counts (AC3)", () => {
    it("attributes a failure to one tool without failing the turn", () => {
      const registry = createMetricsRegistry();

      for (const tool of ["demographics", "problems", "allergies", "immunizations"]) {
        registry.recordToolCall({ tool, latencyMs: 5, failed: false });
      }
      registry.recordToolCall({ tool: "medications", latencyMs: 5, failed: true });
      registry.recordTurn({ latencyMs: 50, failed: false, verdictOk: true });

      const snapshot = registry.snapshot();
      expect(snapshot.tools.medications).toMatchObject({ callsTotal: 1, failuresTotal: 1 });
      expect(snapshot.tools.demographics).toMatchObject({ callsTotal: 1, failuresTotal: 0 });
      // The turn degraded; it is not a failed request.
      expect(snapshot.requestsFailed).toBe(0);
    });

    it("exposes per-tool p95 latency", () => {
      const registry = createMetricsRegistry();
      for (const latencyMs of [10, 20, 30, 40]) {
        registry.recordToolCall({ tool: "labs", latencyMs, failed: false });
      }
      expect(registry.snapshot().tools.labs?.latencyMs.p95).toBe(40);
    });
  });

  describe("verification pass/fail (AC5)", () => {
    it("counts an unverified turn as a verification failure only", () => {
      const registry = createMetricsRegistry();
      registry.recordTurn({ latencyMs: 10, failed: false, verdictOk: false });

      const snapshot = registry.snapshot();
      expect(snapshot.verificationFailTotal).toBe(1);
      expect(snapshot.verificationPassTotal).toBe(0);
      // A dropped claim is a degraded answer, not a failed request.
      expect(snapshot.requestsFailed).toBe(0);
    });

    it("counts a verified turn as a pass", () => {
      const registry = createMetricsRegistry();
      registry.recordTurn({ latencyMs: 10, failed: false, verdictOk: true });

      const snapshot = registry.snapshot();
      expect(snapshot.verificationPassTotal).toBe(1);
      expect(snapshot.verificationFailTotal).toBe(0);
    });
  });

  describe("bounded window (AC6)", () => {
    it("evicts the oldest observation past the window size", () => {
      const registry = createMetricsRegistry({ windowSize: 3 });
      for (const latencyMs of [1000, 10, 20, 30]) {
        registry.recordTurn({ latencyMs, failed: false, verdictOk: true });
      }

      const snapshot = registry.snapshot();
      // Counters are monotonic since start...
      expect(snapshot.requestsTotal).toBe(4);
      // ...but percentiles see only the retained window: the 1000 is gone.
      expect(snapshot.latencyMs.p95).toBe(30);
    });
  });

  describe("retries (bounded regenerate-with-feedback)", () => {
    it("reports zero retries but declares the retry path implemented", () => {
      const snapshot = createMetricsRegistry().snapshot();
      expect(snapshot.retriesTotal).toBe(0);
      // The path exists now; zero means "no retry fired", not "no path".
      expect(snapshot.retryPathImplemented).toBe(true);
    });

    it("accumulates recorded regenerations into retriesTotal", () => {
      const registry = createMetricsRegistry();
      registry.recordRetry({ operation: "grounding", attempts: 1 });
      registry.recordRetry({ operation: "grounding", attempts: 2 });
      expect(registry.snapshot().retriesTotal).toBe(3);
    });

    it("treats a zero-attempt observation as a no-op", () => {
      const registry = createMetricsRegistry();
      registry.recordRetry({ operation: "grounding", attempts: 0 });
      expect(registry.snapshot().retriesTotal).toBe(0);
    });
  });

  describe("eval outcomes (W2 — backs eval_regression_detection)", () => {
    it("accumulates per-category pass/total and the sampled count", () => {
      const registry = createMetricsRegistry();
      registry.recordEval({ schema_valid: true, citation_present: true });
      registry.recordEval({ schema_valid: true, citation_present: false });
      const snap = registry.snapshot();
      expect(snap.eval.sampled).toBe(2);
      expect(snap.eval.categories.schema_valid).toEqual({ pass: 2, total: 2 });
      expect(snap.eval.categories.citation_present).toEqual({ pass: 1, total: 2 });
    });

    it("starts empty", () => {
      const snap = createMetricsRegistry().snapshot();
      expect(snap.eval).toEqual({ categories: {}, sampled: 0 });
    });
  });

  describe("PHI safety (AC8)", () => {
    it("carries no pid, correlation id, or patient data in the snapshot", () => {
      const registry = createMetricsRegistry();
      registry.recordTurn({ latencyMs: 10, failed: false, verdictOk: true });
      registry.recordToolCall({ tool: "medications", latencyMs: 5, failed: false });

      const serialized = JSON.stringify(registry.snapshot());
      for (const forbidden of ["pid", "correlationId", "patient", "uuid"]) {
        expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
      }
    });
  });
});
