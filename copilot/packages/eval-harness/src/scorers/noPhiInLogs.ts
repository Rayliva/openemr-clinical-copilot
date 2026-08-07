/**
 * Rubric scorer — `no_phi_in_logs` (deterministic regression-catcher).
 *
 * Spec: none of the case's `expected.forbiddenInLogs` substrings (e.g. patient name / MRN) may
 * appear in any captured `output.logs` line. Pass = no forbidden substring found anywhere in the
 * logs. An empty (or absent) forbidden list vacuously passes — the case declared nothing to guard.
 *
 * Substring match is exact/case-sensitive by design: the forbidden values are concrete PHI tokens
 * the case supplies, and a fuzzy match would risk false negatives that read as a safe pass.
 *
 * Pure + total. Reports ONLY `no_phi_in_logs`, and ONLY when the case lists it.
 */

import type { CaseRunOutput, GoldenCase, RubricScorer } from "../contracts.js";

function logsClean(output: CaseRunOutput, forbidden: readonly string[]): boolean {
  for (const needle of forbidden) {
    for (const line of output.logs) {
      if (line.includes(needle)) {
        return false;
      }
    }
  }
  return true;
}

export const noPhiInLogsScorer: RubricScorer = (output: CaseRunOutput, goldenCase: GoldenCase) => {
  if (!goldenCase.category.includes("no_phi_in_logs")) {
    return {};
  }
  return { no_phi_in_logs: logsClean(output, goldenCase.expected.forbiddenInLogs ?? []) };
};
