import type { ConstraintAllergies, ConstraintFacts, ConstraintMed } from "@copilot/verification";
import type { AssembledFacts } from "./types.js";

/**
 * Pure projection from assembled snapshot facts to the constraint engine's input
 * shape. Keeps the constraint node thin (orchestrator-only) and `@copilot/verification`
 * decoupled from `@copilot/snapshot`.
 */
export function toConstraintFacts(facts: AssembledFacts): ConstraintFacts {
  const medications: ConstraintMed[] =
    facts.medications !== null && facts.medications.documented
      ? facts.medications.medications.map((m) => ({
          drug: m.drug,
          status: m.status,
          hasConflict: m.hasConflict,
          sourceRefs: m.provenance.map((p) => p.rowUuid),
        }))
      : [];

  return {
    medications,
    allergies: toConstraintAllergies(facts.allergies, facts.unavailableSources.includes("allergies")),
  };
}

function toConstraintAllergies(
  allergies: AssembledFacts["allergies"],
  readFailed: boolean,
): ConstraintAllergies {
  if (allergies === null) {
    if (readFailed) {
      // The read was ATTEMPTED and FAILED. Not an absence — we do not know the
      // allergies. Fire the unavailable guard so a failed read is never treated as
      // safer than a confirmed-empty chart (`verification-gate` rule).
      return { documented: false, reason: "unavailable" };
    }
    // The tool was not run this turn (not wired): assert nothing — neither a
    // contraindication nor "none documented". (In production the allergies tool is
    // always wired, so a null here means a READ FAILURE, handled above via readFailed →
    // `unavailable`; this neutral branch is the deliberate "you opted out of checking" case.)
    return { documented: true, substances: [] };
  }
  if (!allergies.documented) {
    // The record was checked and holds no allergy: the absence guard should fire.
    return { documented: false, reason: "absent" };
  }
  return {
    documented: true,
    substances: allergies.allergies.map((a) => ({ name: a.substance, ref: a.provenance.rowUuid })),
  };
}
