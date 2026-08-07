/**
 * The Week 2 eval GATE self-test (the graded "prove the red" check, `docs/specs/w2-eval-runner.md`
 * §Acceptance S2, `.claude/rules/w2-eval-gate.md`). Runs the FULL committed golden set through the
 * runner against the committed `baseline.json`:
 *   (a) happy run → the gate PASSES and the safety subset is 100% green;
 *   (b) injected run → the gate FAILS, with the deterministic categories (schema_valid /
 *       citation_present / no_phi_in_logs) among those flagged.
 *
 * If this test cannot make the gate go red under injection, the gate is not a gate. Deterministic +
 * offline (stub engine only) — no live LLM/VLM/network.
 */
import { describe, it, expect } from "vitest";
import { runGoldenSet } from "@copilot/eval-harness";
import type { Baseline } from "@copilot/eval-gate";

import { goldenCases } from "./cases/index.js";
import baselineJson from "./baseline.json" with { type: "json" };

const baseline = baselineJson as Baseline;

describe("W2 eval gate", () => {
  it("the committed baseline carries a rate for the exercised categories", () => {
    // A corrupted/incomplete baseline would let the gate run threshold-blind — guard against it here.
    expect(Object.keys(baseline).length).toBeGreaterThan(0);
    for (const rate of Object.values(baseline)) {
      expect(typeof rate).toBe("number");
      expect(Number.isFinite(rate)).toBe(true);
    }
  });

  it("(a) happy run PASSES and the safety subset is 100% green", () => {
    const { verdict, coverage, baselineValidation } = runGoldenSet(goldenCases, { baseline });

    expect(coverage.ok, `coverage shortfalls: ${JSON.stringify(coverage.shortfalls)}`).toBe(true);
    expect(baselineValidation.ok, `baseline problems: ${JSON.stringify(baselineValidation.problems)}`).toBe(true);
    expect(verdict.safetyPassed).toBe(true);
    const failed = verdict.categories.filter((c) => !c.passed);
    expect(failed, `unexpected category failures: ${JSON.stringify(failed)}`).toEqual([]);
    expect(verdict.passed).toBe(true);
  });

  it("(b) injected run FAILS — the gate goes red, proving it can block a regression", () => {
    const { verdict } = runGoldenSet(goldenCases, { injectRegression: true, baseline });

    expect(verdict.passed).toBe(false);

    const flagged = verdict.categories.filter((c) => !c.passed).map((c) => c.category);
    // Every deterministic regression-catcher must fire under injection:
    expect(flagged).toContain("schema_valid"); // ingestion schema drop
    expect(flagged).toContain("citation_present"); // chat uncited claim
    expect(flagged).toContain("no_phi_in_logs"); // PHI leaked into a log line
    // factually_consistent is now oracle-backed: the injected answer uses false-reassurance phrasing
    // ("normal/clear/no allergies/all good"), so the safety absence + contraindication cases go red.
    expect(flagged).toContain("factually_consistent");
    // safe_refusal is now red-able: injection flips the refusal decision, so a must-refuse case answers.
    expect(flagged).toContain("safe_refusal");
    // And an injected safety-case failure (PHI leak + false reassurance in safety cases) fails the subset.
    expect(verdict.safetyPassed).toBe(false);
  });

  it("is deterministic — the injected verdict is identical across runs", () => {
    const a = runGoldenSet(goldenCases, { injectRegression: true, baseline });
    const b = runGoldenSet(goldenCases, { injectRegression: true, baseline });
    expect(a.verdict).toEqual(b.verdict);
  });
});
