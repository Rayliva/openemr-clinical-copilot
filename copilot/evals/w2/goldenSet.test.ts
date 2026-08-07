/**
 * Golden-set validation (T2). Asserts, against the FROZEN contract, that:
 *   (a) every case parses clean against `GoldenCaseSchema` (`.strict()` — a typo'd key fails loudly);
 *   (b) the safety subset (`safety: true`) is non-empty AND covers the four required scenarios;
 *   (c) every rubric category and BOTH `kind`s are represented;
 *   (d) case ids are unique and every case is tagged `week:2`.
 *
 * This is the acceptance gate for the data-authoring task — no runtime agent code is exercised.
 */
import { describe, expect, it } from "vitest";
import {
  GoldenCaseSchema,
  RUBRIC_CATEGORIES,
  type GoldenCase,
  type RubricCategory,
} from "@copilot/eval-harness";

import { goldenCases } from "./cases/index.js";

const parsed: GoldenCase[] = goldenCases.map((c) => GoldenCaseSchema.parse(c));

describe("W2 golden set", () => {
  it("has a meaningful number of cases (breadth toward 50)", () => {
    expect(parsed.length).toBeGreaterThanOrEqual(50);
  });

  it("every case parses clean against the frozen GoldenCaseSchema (.strict())", () => {
    // The .map above already parsed; re-assert per case so a failure names the offending id.
    for (const c of goldenCases) {
      const result = GoldenCaseSchema.safeParse(c);
      expect(result.success, `case failed schema: ${JSON.stringify(c.id)}`).toBe(true);
    }
  });

  it("every case is tagged week:2", () => {
    for (const c of parsed) {
      expect(c.week).toBe("week:2");
    }
  });

  it("case ids are unique", () => {
    const ids = parsed.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has a non-empty safety subset", () => {
    const safety = parsed.filter((c) => c.safety);
    expect(safety.length).toBeGreaterThan(0);
  });

  it("safety subset covers the required scenarios", () => {
    const safety = parsed.filter((c) => c.safety);
    const ids = new Set(safety.map((c) => c.id));
    // non-owned pid refusal
    expect([...ids].some((id) => id.includes("nonowned-pid"))).toBe(true);
    // absence ≠ negative finding
    expect([...ids].some((id) => id.includes("absence"))).toBe(true);
    // contraindication / allergy
    expect([...ids].some((id) => id.includes("contraindication"))).toBe(true);
    // out-of-scope / ungrounded request
    expect(
      [...ids].some((id) => id.includes("ungrounded") || id.includes("out-of-scope")),
    ).toBe(true);
    // drug–drug interaction (constraint engine)
    expect([...ids].some((id) => id.includes("interaction"))).toBe(true);
    // duplicate / overlapping therapy (constraint engine)
    expect([...ids].some((id) => id.includes("duplicate"))).toBe(true);
  });

  it("every safety case sets an expectation the scorer can read", () => {
    for (const c of parsed.filter((x) => x.safety)) {
      const e = c.expected;
      const hasOracle = (e.mustContain?.length ?? 0) > 0 || (e.mustNotContain?.length ?? 0) > 0;
      const hasExpectation =
        e.mustRefuse === true ||
        e.mustCite === true ||
        e.factuallyConsistent === true ||
        hasOracle ||
        (e.forbiddenInLogs?.length ?? 0) > 0;
      expect(hasExpectation, `safety case has no actionable expected: ${c.id}`).toBe(true);
      // A safety case exercising factually_consistent MUST back it with a red-able text oracle
      // (mustContain/mustNotContain), never the constant boolean — that constant can't catch a
      // regression, and two absence safety cases were previously vacuous because of it. This guards
      // against the no-op returning.
      if (c.category.includes("factually_consistent")) {
        expect(
          hasOracle,
          `safety factually_consistent case must use a mustContain/mustNotContain oracle, not the constant boolean: ${c.id}`,
        ).toBe(true);
      }
    }
  });

  it("every rubric category is represented by at least one case", () => {
    const covered = new Set<RubricCategory>();
    for (const c of parsed) {
      for (const cat of c.category) {
        covered.add(cat);
      }
    }
    for (const cat of RUBRIC_CATEGORIES) {
      expect(covered.has(cat), `no case exercises category: ${cat}`).toBe(true);
    }
  });

  it("both input kinds are represented", () => {
    const kinds = new Set(parsed.map((c) => c.input.kind));
    expect(kinds.has("chat")).toBe(true);
    expect(kinds.has("ingestion")).toBe(true);
  });

  it("every ingestion case references at least one fixture", () => {
    for (const c of parsed.filter((x) => x.input.kind === "ingestion")) {
      expect(c.fixtureRefs.length, `ingestion case missing fixtureRefs: ${c.id}`).toBeGreaterThan(0);
    }
  });

  it("no_phi_in_logs cases carry forbidden PHI substrings", () => {
    for (const c of parsed.filter((x) => x.category.includes("no_phi_in_logs"))) {
      expect(
        (c.expected.forbiddenInLogs?.length ?? 0) > 0,
        `no_phi_in_logs case has no forbiddenInLogs: ${c.id}`,
      ).toBe(true);
    }
  });
});
