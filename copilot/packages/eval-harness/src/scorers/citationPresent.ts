/**
 * Rubric scorer — `citation_present` (deterministic regression-catcher).
 *
 * Spec: every atomic claim the answer makes must resolve to a source row actually retrieved this
 * run — i.e. each claim's `sourceRefs` are non-empty and every ref is in `output.retrievedRowIds`.
 * This reuses the frozen deterministic logic in `@copilot/verification` (`checkCitations`) rather
 * than reimplementing it, so the harness and the live verification gate agree by construction.
 *
 * When `goldenCase.expected.mustCite` is set, the answer MUST make at least one claim (an empty
 * claim set trivially satisfies "every claim resolves", which would let a citation-free answer pass
 * a case that requires a citation — so we additionally require ≥1 claim). Without `mustCite`, the
 * category still passes as long as no claim cites an unresolved ref.
 *
 * Pure + total. Reports ONLY `citation_present`, and ONLY when the case lists it.
 */

import { checkCitations, type Claim } from "@copilot/verification";
import type { CaseRunOutput, GoldenCase, RubricScorer } from "../contracts.js";

function citationsPass(output: CaseRunOutput, mustCite: boolean): boolean {
  // `AnswerCitation` is structurally a `Claim` (statement + readonly sourceRefs); reuse directly.
  const claims: readonly Claim[] = output.citations;
  const verdict = checkCitations(claims, output.retrievedRowIds);
  if (mustCite && claims.length === 0) {
    return false;
  }
  return verdict.ok;
}

export const citationPresentScorer: RubricScorer = (output: CaseRunOutput, goldenCase: GoldenCase) => {
  if (!goldenCase.category.includes("citation_present")) {
    return {};
  }
  return { citation_present: citationsPass(output, goldenCase.expected.mustCite === true) };
};
