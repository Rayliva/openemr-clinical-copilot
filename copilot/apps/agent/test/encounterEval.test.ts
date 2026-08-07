import { describe, it, expect } from "vitest";
import { evaluateEncounter } from "../src/observability/encounterEval.js";

describe("evaluateEncounter — deterministic per-encounter eval outcome", () => {
  it("passes all deterministic categories for a clean grounded turn", () => {
    expect(
      evaluateEncounter({
        generationOk: true,
        groundedClaims: [{ statement: "A1c 8.1", sourceRefs: ["lab-1"] }],
        retrievedRefs: ["lab-1"],
        ungroundedCount: 0,
      }),
    ).toEqual({
      schema_valid: true,
      citation_present: true,
      grounding_ok: true,
      no_phi_in_logs: true,
    });
  });

  it("marks schema_valid false when generation failed", () => {
    const r = evaluateEncounter({
      generationOk: false,
      groundedClaims: [],
      retrievedRefs: [],
      ungroundedCount: 0,
    });
    expect(r.schema_valid).toBe(false);
  });

  it("marks citation_present false when a surfaced claim cites an unretrieved row", () => {
    const r = evaluateEncounter({
      generationOk: true,
      groundedClaims: [{ statement: "x", sourceRefs: ["ghost"] }],
      retrievedRefs: ["lab-1"],
      ungroundedCount: 0,
    });
    expect(r.citation_present).toBe(false);
  });

  it("marks grounding_ok false when the judge dropped a claim this turn", () => {
    const r = evaluateEncounter({
      generationOk: true,
      groundedClaims: [{ statement: "x", sourceRefs: ["lab-1"] }],
      retrievedRefs: ["lab-1"],
      ungroundedCount: 1,
    });
    expect(r.grounding_ok).toBe(false);
  });

  it("citation_present is vacuously true for a degraded (no-claim) turn", () => {
    const r = evaluateEncounter({
      generationOk: true,
      groundedClaims: [],
      retrievedRefs: ["lab-1"],
      ungroundedCount: 0,
    });
    expect(r.citation_present).toBe(true);
  });
});
