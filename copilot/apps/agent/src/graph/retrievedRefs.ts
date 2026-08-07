import type { AssembledFacts } from "./types.js";

/**
 * Pure projection: the set of provenance row UUIDs actually retrieved this turn — the
 * whitelist the citation check (layer 1) enforces. A claim may only cite a row in here.
 *
 * Handles every source uniformly whether it was fetched (safety core) or not (an optional
 * source the model didn't gather stays `null` → contributes nothing), so it can be recomputed
 * over the enriched facts after the `gather` node without special-casing.
 */
export function collectRetrievedRefs(facts: AssembledFacts): string[] {
  const refs: string[] = [];

  if (facts.demographics !== null) {
    refs.push(facts.demographics.provenance.rowUuid);
  }
  if (facts.problems !== null && facts.problems.documented) {
    for (const problem of facts.problems.problems) {
      refs.push(problem.provenance.rowUuid);
    }
  }
  if (facts.medications !== null && facts.medications.documented) {
    for (const med of facts.medications.medications) {
      for (const p of med.provenance) {
        refs.push(p.rowUuid);
      }
    }
  }
  if (facts.allergies !== null && facts.allergies.documented) {
    for (const allergy of facts.allergies.allergies) {
      refs.push(allergy.provenance.rowUuid);
    }
  }
  if (facts.vitals !== null && facts.vitals.documented) {
    for (const reading of facts.vitals.observations) {
      refs.push(reading.provenance.rowUuid);
    }
  }
  if (facts.labs !== null && facts.labs.documented) {
    for (const reading of facts.labs.observations) {
      refs.push(reading.provenance.rowUuid);
    }
  }
  if (facts.immunizations !== null && facts.immunizations.documented) {
    for (const immunization of facts.immunizations.immunizations) {
      refs.push(immunization.provenance.rowUuid);
    }
  }

  return refs;
}
