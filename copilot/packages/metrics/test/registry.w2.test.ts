import { describe, expect, it } from "vitest";
import { createMetricsRegistry } from "../src/registry.js";

/**
 * Week-2 signals: ingestion, retrieval, supervisor. Spec: docs/specs/w2-observability.md §1.
 * Behavior only — the snapshot is the observable surface; PHI-free (types/states/counts).
 */
describe("MetricsRegistry — W2 ingestion signals", () => {
  it("counts an ok lab draft with per-field located vs forced-review", () => {
    const r = createMetricsRegistry();
    r.recordIngestion({
      docType: "lab_pdf",
      outcome: "ok",
      fieldsLocated: 3,
      fieldsForcedReview: 1,
      latencyMs: 1200,
    });

    const s = r.snapshot();
    expect(s.ingestion.documentsTotal).toBe(1);
    expect(s.ingestion.byDocType.lab_pdf).toEqual({ total: 1, ok: 1, degraded: 0 });
    expect(s.ingestion.extractionOk).toBe(1);
    expect(s.ingestion.extractionDegraded).toBe(0);
    expect(s.ingestion.fieldsLocated).toBe(3);
    expect(s.ingestion.fieldsForcedReview).toBe(1);
    expect(s.ingestion.extractionLatencyMs.p50).toBe(1200);
  });

  it("counts a degraded draft with no field samples, keyed by doc type", () => {
    const r = createMetricsRegistry();
    r.recordIngestion({
      docType: "intake_form",
      outcome: "degraded",
      fieldsLocated: 0,
      fieldsForcedReview: 0,
      latencyMs: 900,
    });

    const s = r.snapshot();
    expect(s.ingestion.documentsTotal).toBe(1);
    expect(s.ingestion.byDocType.intake_form).toEqual({ total: 1, ok: 0, degraded: 1 });
    expect(s.ingestion.extractionDegraded).toBe(1);
    expect(s.ingestion.fieldsLocated).toBe(0);
  });

  it("separates counts per doc type", () => {
    const r = createMetricsRegistry();
    r.recordIngestion({ docType: "lab_pdf", outcome: "ok", fieldsLocated: 2, fieldsForcedReview: 0, latencyMs: 10 });
    r.recordIngestion({ docType: "intake_form", outcome: "ok", fieldsLocated: 1, fieldsForcedReview: 2, latencyMs: 20 });

    const s = r.snapshot();
    expect(s.ingestion.documentsTotal).toBe(2);
    expect(s.ingestion.byDocType.lab_pdf?.total).toBe(1);
    expect(s.ingestion.byDocType.intake_form?.total).toBe(1);
    expect(s.ingestion.fieldsLocated).toBe(3);
    expect(s.ingestion.fieldsForcedReview).toBe(2);
  });
});

describe("MetricsRegistry — W2 retrieval signals", () => {
  it("records a reranked query as hits + rerank used", () => {
    const r = createMetricsRegistry();
    r.recordRetrieval({ snippets: 3, rerank: "used", latencyMs: 350 });

    const s = r.snapshot();
    expect(s.retrieval.queriesTotal).toBe(1);
    expect(s.retrieval.snippetsTotal).toBe(3);
    expect(s.retrieval.zeroHitQueries).toBe(0);
    expect(s.retrieval.rerankUsed).toBe(1);
    expect(s.retrieval.rerankDegraded).toBe(0);
    expect(s.retrieval.latencyMs.p50).toBe(350);
  });

  it("records a zero-hit query as a miss", () => {
    const r = createMetricsRegistry();
    r.recordRetrieval({ snippets: 0, rerank: "used", latencyMs: 100 });
    expect(r.snapshot().retrieval.zeroHitQueries).toBe(1);
  });

  it("records a rerank fallback as degraded (not a failure)", () => {
    const r = createMetricsRegistry();
    r.recordRetrieval({ snippets: 5, rerank: "degraded", latencyMs: 200 });

    const s = r.snapshot();
    expect(s.retrieval.rerankDegraded).toBe(1);
    expect(s.retrieval.rerankUsed).toBe(0);
    expect(s.retrieval.snippetsTotal).toBe(5);
  });
});

describe("MetricsRegistry — W2 supervisor signals", () => {
  it("counts routing decisions per target and terminal turns", () => {
    const r = createMetricsRegistry();
    r.recordRouting({ target: "intake_extractor", terminal: false, hopCapped: false });
    r.recordRouting({ target: "ready", terminal: true, hopCapped: false });

    const s = r.snapshot();
    expect(s.supervisor.routes.intake_extractor).toBe(1);
    expect(s.supervisor.routes.ready).toBe(1);
    expect(s.supervisor.turnsRouted).toBe(1);
    expect(s.supervisor.hopCapHits).toBe(0);
  });

  it("records a hop-cap hit", () => {
    const r = createMetricsRegistry();
    r.recordRouting({ target: "ready", terminal: true, hopCapped: true });
    expect(r.snapshot().supervisor.hopCapHits).toBe(1);
    expect(r.snapshot().supervisor.turnsRouted).toBe(1);
  });
});

describe("MetricsRegistry — W2 PHI safety", () => {
  it("carries no pid, correlation id, title, or patient data in the W2 snapshot", () => {
    const r = createMetricsRegistry();
    r.recordIngestion({ docType: "lab_pdf", outcome: "ok", fieldsLocated: 1, fieldsForcedReview: 0, latencyMs: 5 });
    r.recordRetrieval({ snippets: 2, rerank: "used", latencyMs: 5 });
    r.recordRouting({ target: "evidence_retriever", terminal: false, hopCapped: false });

    const serialized = JSON.stringify(r.snapshot()).toLowerCase();
    for (const forbidden of ["pid", "correlationid", "patient", "uuid", "title", "quote"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("starts empty (zeros, null percentiles) with no W2 activity", () => {
    const s = createMetricsRegistry().snapshot();
    expect(s.ingestion.documentsTotal).toBe(0);
    expect(s.ingestion.extractionLatencyMs.p50).toBeNull();
    expect(s.retrieval.queriesTotal).toBe(0);
    expect(s.retrieval.latencyMs.p95).toBeNull();
    expect(s.supervisor.turnsRouted).toBe(0);
    expect(s.supervisor.routes).toEqual({});
  });
});
