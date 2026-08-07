/**
 * Rubric scorer — `factually_consistent` (deterministic, boolean — never a 1–10 score, per
 * `w2-eval-gate`).
 *
 * A case declares its ground truth in one of two ways:
 *  - **Text oracle (preferred):** `expected.mustContain` / `expected.mustNotContain` — case-insensitive
 *    substrings the answer MUST / MUST NOT contain. When either is present the scorer evaluates the
 *    ACTUAL `output.text`, so a factual regression (e.g. answering "her labs are normal" on an empty
 *    chart — the "absence ≠ negative finding" safety failure) goes red. This is what makes the category
 *    a real regression-catcher rather than a constant.
 *  - **Fallback:** `expected.factuallyConsistent` (a precomputed boolean) for cases with no text oracle.
 *    A constant cannot catch a regression, so this is legacy — a case listing the category but giving
 *    NEITHER an oracle NOR the boolean fails closed (`false`), surfacing the gap rather than passing.
 *
 * Pure + total. Reports ONLY `factually_consistent`, and ONLY when the case lists it.
 */

import type { CaseRunOutput, GoldenCase, RubricScorer } from "../contracts.js";

export const factuallyConsistentScorer: RubricScorer = (
  output: CaseRunOutput,
  goldenCase: GoldenCase,
) => {
  if (!goldenCase.category.includes("factually_consistent")) {
    return {};
  }
  const { mustContain, mustNotContain, factuallyConsistent } = goldenCase.expected;

  if (mustContain !== undefined || mustNotContain !== undefined) {
    const haystack = output.text.toLowerCase();
    const containsAllRequired = (mustContain ?? []).every((s) => haystack.includes(s.toLowerCase()));
    const containsNoForbidden = (mustNotContain ?? []).every((s) => !haystack.includes(s.toLowerCase()));
    return { factually_consistent: containsAllRequired && containsNoForbidden };
  }

  return { factually_consistent: factuallyConsistent === true };
};
