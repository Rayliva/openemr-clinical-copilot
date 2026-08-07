import { describe, it, expect } from "vitest";
import { draftConfidence } from "../src/ingestion/ingestionService.js";

/** Minimal structural draft — draftConfidence reads only status + results[].result.confidence. */
const okDraft = (confidences: number[]) => ({
  status: "ok" as const,
  results: confidences.map((confidence) => ({ result: { confidence } })),
});

describe("draftConfidence — numeric per-document extraction confidence", () => {
  it("reports min + mean (2dp) + field count over an ok draft's results", () => {
    expect(draftConfidence(okDraft([0.99, 0.8, 0.6]))).toEqual({
      confidenceMin: 0.6,
      confidenceMean: 0.8, // (0.99+0.8+0.6)/3 = 0.7967 -> 0.80
      fields: 3,
    });
  });

  it("returns null for a degraded draft (no results to score)", () => {
    expect(draftConfidence({ status: "degraded" })).toBeNull();
  });

  it("returns null for an ok draft with zero results", () => {
    expect(draftConfidence(okDraft([]))).toBeNull();
  });

  it("rounds the mean to two decimals", () => {
    expect(draftConfidence(okDraft([0.333, 0.333, 0.333]))?.confidenceMean).toBe(0.33);
  });
});
