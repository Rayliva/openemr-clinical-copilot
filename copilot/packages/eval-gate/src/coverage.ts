import {
  RUBRIC_CATEGORIES,
  scoreCategories,
  type Baseline,
  type CaseResult,
  type RubricCategory,
} from "./gate.js";

/**
 * Runner-level guards the pure gate cannot enforce (`docs/specs/w2-eval-gate.md`): a regression can
 * escape `evaluateGate` by *coverage drop* (deleting a category's cases → the category isn't judged)
 * or by a *corrupted baseline* (all-NaN → regression detection silently disabled). These pure checks
 * run in the runner before the gate.
 */

export interface CoverageShortfall {
  readonly category: RubricCategory;
  readonly required: number;
  readonly actual: number;
}

export interface CoverageResult {
  readonly ok: boolean;
  readonly shortfalls: readonly CoverageShortfall[];
}

/**
 * Assert each required category has at least its minimum number of exercising cases — so a silent
 * coverage drop (deleting cases) cannot make a category disappear from the gate and pass green.
 */
export function checkCoverage(
  cases: readonly CaseResult[],
  minPerCategory: Partial<Record<RubricCategory, number>>,
): CoverageResult {
  const totalByCategory = new Map(scoreCategories(cases).map((s) => [s.category, s.total]));
  const shortfalls: CoverageShortfall[] = [];
  for (const category of RUBRIC_CATEGORIES) {
    const required = minPerCategory[category];
    if (required === undefined) {
      continue;
    }
    const actual = totalByCategory.get(category) ?? 0;
    if (actual < required) {
      shortfalls.push({ category, required, actual });
    }
  }
  return { ok: shortfalls.length === 0, shortfalls };
}

export interface BaselineProblem {
  readonly category: RubricCategory;
  readonly issue: string;
}

export interface BaselineValidation {
  readonly ok: boolean;
  readonly problems: readonly BaselineProblem[];
}

/**
 * Assert the loaded baseline carries a valid rate in [0,1] for every required category — reject a
 * corrupted/incomplete baseline rather than let the gate run half-blind (a missing or NaN rate
 * disables regression detection for that category).
 */
export function validateBaseline(
  baseline: Baseline,
  required: readonly RubricCategory[],
): BaselineValidation {
  const problems: BaselineProblem[] = [];
  for (const category of required) {
    const value = baseline[category];
    if (value === undefined) {
      problems.push({ category, issue: "missing from baseline" });
    } else if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
      problems.push({ category, issue: "not a valid rate in [0,1]" });
    }
  }
  return { ok: problems.length === 0, problems };
}
