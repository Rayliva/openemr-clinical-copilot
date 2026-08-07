import { checkCitations, type Claim } from "@copilot/verification";

/**
 * The deterministic per-encounter eval outcome (Week 2 Core Req 7: "each encounter must log …
 * eval outcome"). These are the boolean rubric categories that can be decided on a LIVE turn
 * without a golden expected answer — evaluated on the turn's own output, logged + traced PHI-free.
 * `factually_consistent` and `safe_refusal` need a golden expectation, so they stay CI-only.
 */
export interface EncounterEval {
  /** Generation produced structurally valid claims (no generation/parse failure this turn). */
  readonly schema_valid: boolean;
  /** Every surfaced claim resolves to a row actually retrieved this turn (same check as the gate). */
  readonly citation_present: boolean;
  /** The grounding judge dropped nothing this turn. */
  readonly grounding_ok: boolean;
  /** Invariant: structured logging never interpolates PHI (true by construction; CI-enforced). */
  readonly no_phi_in_logs: boolean;
}

export interface EncounterEvalInput {
  readonly generationOk: boolean;
  readonly groundedClaims: readonly Claim[];
  readonly retrievedRefs: Iterable<string>;
  readonly ungroundedCount: number;
}

/**
 * Compute the deterministic eval outcome for one encounter. Pure; reuses the frozen
 * `checkCitations` so the per-encounter `citation_present` agrees with the verification gate by
 * construction. `citation_present` is vacuously true for a degraded (no-claim) turn — there is no
 * uncited claim to fail on.
 */
export function evaluateEncounter(input: EncounterEvalInput): EncounterEval {
  return {
    schema_valid: input.generationOk,
    citation_present: checkCitations(input.groundedClaims, input.retrievedRefs).ok,
    grounding_ok: input.ungroundedCount === 0,
    no_phi_in_logs: true,
  };
}
