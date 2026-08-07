/**
 * Barrel for the boolean rubric scorers (T1). Each scorer matches the frozen `RubricScorer`
 * signature and reports ONLY the category it measures — an untouched category is absent from the map
 * (never `false`). `allScorers` is the ordered set the runner (T4) applies per case, merging the
 * partial maps into one `CaseResult.results`.
 *
 * The orchestrator wires this subdir barrel into the package barrel (`src/index.ts`) at integration;
 * builders do not edit that file.
 */

import type { RubricScorer } from "../contracts.js";
import { schemaValidScorer } from "./schemaValid.js";
import { citationPresentScorer } from "./citationPresent.js";
import { noPhiInLogsScorer } from "./noPhiInLogs.js";
import { safeRefusalScorer } from "./safeRefusal.js";
import { factuallyConsistentScorer } from "./factuallyConsistent.js";

export { schemaValidScorer } from "./schemaValid.js";
export { citationPresentScorer } from "./citationPresent.js";
export { noPhiInLogsScorer } from "./noPhiInLogs.js";
export { safeRefusalScorer } from "./safeRefusal.js";
export { factuallyConsistentScorer } from "./factuallyConsistent.js";

/** Every rubric scorer, in category-declaration order. */
export const allScorers: readonly RubricScorer[] = [
  schemaValidScorer,
  citationPresentScorer,
  factuallyConsistentScorer,
  safeRefusalScorer,
  noPhiInLogsScorer,
];
