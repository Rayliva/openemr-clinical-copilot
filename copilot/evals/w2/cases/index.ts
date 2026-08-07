/**
 * Barrel for the Week 2 golden set — the single import surface the T4 runner + T1 scorers consume.
 * Every case is a `week:2` `GoldenCase`; the colocated `goldenSet.test.ts` proves each parses against
 * the frozen `GoldenCaseSchema`, the safety subset is non-empty, and all rubric categories + both
 * `kind`s are represented. Synthetic (seed) data only — never real PHI.
 */
import type { GoldenCase } from "@copilot/eval-harness";

import { chatIdentityCases } from "./chat-identity.js";
import { chatMedicationCases } from "./chat-medications.js";
import { chatLabsAbsenceCases } from "./chat-labs-absence.js";
import { chatHuddleCases } from "./chat-huddle.js";
import { chatFollowupCases } from "./chat-followups.js";
import { chatSafetyCases } from "./chat-safety.js";
import { ingestionLabCases } from "./ingestion-lab.js";
import { ingestionIntakeCases } from "./ingestion-intake.js";
import { ingestionSafetyCases } from "./ingestion-safety.js";
import { phiLogCases } from "./phi-logs.js";

/** The full Week 2 golden set, aggregated from the per-theme case modules. */
export const goldenCases: GoldenCase[] = [
  ...chatIdentityCases,
  ...chatMedicationCases,
  ...chatLabsAbsenceCases,
  ...chatHuddleCases,
  ...chatFollowupCases,
  ...chatSafetyCases,
  ...ingestionLabCases,
  ...ingestionIntakeCases,
  ...ingestionSafetyCases,
  ...phiLogCases,
];
