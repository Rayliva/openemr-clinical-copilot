import { describe, it, expect } from "vitest";
import { checkCoverage, validateBaseline } from "../src/coverage.js";
import type { CaseResult, Baseline } from "../src/gate.js";

describe("checkCoverage — guard against a silent coverage drop", () => {
  const cases: CaseResult[] = [
    { id: "1", results: { schema_valid: true, citation_present: true } },
    { id: "2", results: { schema_valid: true } },
    { id: "3", results: { citation_present: false } },
  ];

  it("passes when every required category meets its minimum case count", () => {
    const r = checkCoverage(cases, { schema_valid: 2, citation_present: 2 });
    expect(r.ok).toBe(true);
    expect(r.shortfalls).toHaveLength(0);
  });

  it("flags a category with fewer cases than required (the deleted-cases regression escape)", () => {
    const r = checkCoverage(cases, { schema_valid: 2, citation_present: 3, safe_refusal: 1 });
    expect(r.ok).toBe(false);
    // citation_present has 2 (need 3); safe_refusal has 0 (need 1); schema_valid has 2 (ok)
    const cats = r.shortfalls.map((s) => s.category).sort();
    expect(cats).toEqual(["citation_present", "safe_refusal"]);
    const cite = r.shortfalls.find((s) => s.category === "citation_present");
    expect(cite).toMatchObject({ required: 3, actual: 2 });
  });
});

describe("validateBaseline — reject a corrupted/incomplete baseline", () => {
  it("passes a complete, in-range baseline for the required categories", () => {
    const baseline: Baseline = { schema_valid: 1, citation_present: 0.95 };
    const r = validateBaseline(baseline, ["schema_valid", "citation_present"]);
    expect(r.ok).toBe(true);
    expect(r.problems).toHaveLength(0);
  });

  it("flags a missing required category", () => {
    const r = validateBaseline({ schema_valid: 1 }, ["schema_valid", "citation_present"]);
    expect(r.ok).toBe(false);
    expect(r.problems.map((p) => p.category)).toContain("citation_present");
  });

  it("flags an out-of-range or NaN baseline rate (would silently disable regression detection)", () => {
    const bad = { schema_valid: 2, citation_present: Number.NaN } as unknown as Baseline;
    const r = validateBaseline(bad, ["schema_valid", "citation_present"]);
    expect(r.ok).toBe(false);
    expect(r.problems.map((p) => p.category).sort()).toEqual(["citation_present", "schema_valid"]);
  });
});
