import { describe, it, expect } from "vitest";
import {
  scoreCategories,
  evaluateGate,
  type CaseResult,
  type Baseline,
} from "../src/gate.js";

describe("scoreCategories", () => {
  it("aggregates passed/total/rate per category, ignoring categories a case does not exercise", () => {
    const cases: CaseResult[] = [
      { id: "a", results: { schema_valid: true, citation_present: true } },
      { id: "b", results: { schema_valid: false } }, // does not exercise citation_present
      { id: "c", results: { citation_present: true } },
    ];
    const scores = scoreCategories(cases);
    const schema = scores.find((s) => s.category === "schema_valid");
    const cite = scores.find((s) => s.category === "citation_present");
    expect(schema).toMatchObject({ passed: 1, total: 2, rate: 0.5 });
    expect(cite).toMatchObject({ passed: 2, total: 2, rate: 1 });
  });
});

describe("evaluateGate — the graded regression mechanic", () => {
  const baseline: Baseline = {
    schema_valid: 1,
    citation_present: 1,
    factually_consistent: 0.9,
    no_phi_in_logs: 1,
  };
  const thresholds = { schema_valid: 1, citation_present: 1, no_phi_in_logs: 1 };

  it("passes when every category is at/above baseline and threshold", () => {
    const cases: CaseResult[] = [
      { id: "1", results: { schema_valid: true, citation_present: true, no_phi_in_logs: true } },
      { id: "2", results: { factually_consistent: true } },
    ];
    const v = evaluateGate(cases, baseline, { thresholds });
    expect(v.passed).toBe(true);
    expect(v.safetyPassed).toBe(true);
  });

  it("FAILS when a category regresses more than 5% vs baseline (the injected-regression case)", () => {
    // citation_present drops from 1.0 baseline to 0.5 → a 50% regression
    const cases: CaseResult[] = [
      { id: "1", results: { citation_present: true } },
      { id: "2", results: { citation_present: false } },
    ];
    const v = evaluateGate(cases, baseline, { thresholds });
    expect(v.passed).toBe(false);
    const cite = v.categories.find((c) => c.category === "citation_present");
    expect(cite?.passed).toBe(false);
    expect(cite?.reason.toLowerCase()).toMatch(/regress/);
  });

  it("does NOT fail on a small drop within the 5% tolerance", () => {
    // factually_consistent 0.9 baseline → 0.87 current (3% drop, no absolute threshold)
    const cases: CaseResult[] = Array.from({ length: 100 }, (_, i) => ({
      id: `c${i}`,
      results: { factually_consistent: i >= 13 }, // 87 pass / 100 = 0.87
    }));
    const v = evaluateGate(cases, baseline, { maxRegression: 0.05 });
    expect(v.categories.find((c) => c.category === "factually_consistent")?.passed).toBe(true);
    expect(v.passed).toBe(true);
  });

  it("FAILS a category below its absolute threshold even if it did not regress (bad-baseline guard)", () => {
    // current rate == baseline (0.5): NO regression, but the threshold demands 1.0 → fail on threshold
    const v = evaluateGate(
      [
        { id: "1", results: { schema_valid: true } },
        { id: "2", results: { schema_valid: false } },
      ],
      { schema_valid: 0.5 },
      { thresholds: { schema_valid: 1 } },
    );
    expect(v.passed).toBe(false);
    const s = v.categories.find((c) => c.category === "schema_valid");
    expect(s?.passed).toBe(false);
    expect(s?.reason.toLowerCase()).toMatch(/threshold|below/);
  });

  it("FAILS the whole gate when a safety-critical case fails, regardless of category rates", () => {
    const cases: CaseResult[] = [
      { id: "safe-1", safety: true, results: { safe_refusal: false } },
      // plenty of passing non-safety cases so no category rate looks bad on its own
      ...Array.from({ length: 20 }, (_, i) => ({ id: `ok${i}`, results: { safe_refusal: true } })),
    ];
    const v = evaluateGate(cases, { safe_refusal: 0.9 }, {});
    expect(v.safetyPassed).toBe(false);
    expect(v.passed).toBe(false);
  });

  it("a drop of EXACTLY 5% does not fail (float-boundary safe); 6% does", () => {
    const at5 = Array.from({ length: 100 }, (_, i) => ({
      id: `a${i}`,
      results: { factually_consistent: i >= 5 }, // 95/100 = 0.95, baseline 1.0 → exactly 0.05 drop
    }));
    expect(
      evaluateGate(at5, { factually_consistent: 1 }, {}).categories.find(
        (c) => c.category === "factually_consistent",
      )?.passed,
    ).toBe(true);

    const at6 = Array.from({ length: 100 }, (_, i) => ({
      id: `b${i}`,
      results: { factually_consistent: i >= 6 }, // 94/100 = 0.94 → 0.06 drop → fail
    }));
    expect(evaluateGate(at6, { factually_consistent: 1 }, {}).passed).toBe(false);
  });

  it("a safety case that asserts nothing fails closed (never a vacuous pass)", () => {
    const v = evaluateGate([{ id: "s", safety: true, results: {} }], {}, {});
    expect(v.safetyPassed).toBe(false);
    expect(v.passed).toBe(false);
  });

  it("treats a category absent from the baseline as no regression (threshold-only)", () => {
    const cases: CaseResult[] = [{ id: "1", results: { safe_refusal: true } }];
    const v = evaluateGate(cases, {}, {}); // empty baseline
    const s = v.categories.find((c) => c.category === "safe_refusal");
    expect(s?.baselineRate).toBeNull();
    expect(s?.passed).toBe(true);
    expect(v.passed).toBe(true);
  });

  it("passes on improvement (current above baseline)", () => {
    const v = evaluateGate(
      [{ id: "1", results: { factually_consistent: true } }],
      { factually_consistent: 0.5 },
      {},
    );
    expect(v.passed).toBe(true);
  });

  it("does not throw on a malformed baseline entry (treats it as absent)", () => {
    const bad = { schema_valid: Number.NaN, citation_present: 2 } as unknown as Baseline;
    const cases: CaseResult[] = [{ id: "1", results: { schema_valid: true, citation_present: true } }];
    expect(() => evaluateGate(cases, bad, {})).not.toThrow();
    const v = evaluateGate(cases, bad, {});
    // NaN/out-of-range baselines ignored → no spurious regression
    expect(v.passed).toBe(true);
  });
});
