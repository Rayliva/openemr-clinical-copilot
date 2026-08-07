import type { MedicationDosage } from "@copilot/snapshot";
import type { AssembledFacts } from "./types.js";

/**
 * Serialize a prescription's dosage the same way `generate` renders it, so the judge's
 * evidence carries the dose/route/sig a claim may assert. Absent dosage renders as
 * nothing — "no dose on file" stays a documented absence, never an invented field.
 */
function evidenceDosage(dosage: MedicationDosage | undefined): string {
  if (dosage === undefined) {
    return "";
  }
  const parts: string[] = [];
  if (dosage.dose !== undefined) {
    parts.push(`dose ${dosage.dose}`);
  }
  if (dosage.route !== undefined) {
    parts.push(`route ${dosage.route}`);
  }
  if (dosage.text !== undefined) {
    parts.push(`sig "${dosage.text}"`);
  }
  return parts.length > 0 ? `; ${parts.join(", ")}` : "";
}

/**
 * Pure projection from assembled snapshot facts to an evidence index: `rowUuid ->
 * short serialized content of that row`. The grounding judge (layer 2) resolves a
 * claim's cited refs through this map, so it sees *only* the rows a claim cites —
 * never the whole snapshot (`verification-gate` rule). Keeps the grounding node thin
 * (orchestrator-only).
 */
export function toEvidenceIndex(facts: AssembledFacts): Record<string, string> {
  const index: Record<string, string> = {};

  const demographics = facts.demographics;
  if (demographics !== null) {
    const parts = [`Patient: ${demographics.name}`];
    if (demographics.birthDate !== undefined && demographics.birthDate !== null) {
      parts.push(`DOB ${demographics.birthDate}`);
    }
    if (demographics.age !== undefined && demographics.age !== null) {
      parts.push(`age ${demographics.age}`);
    }
    if (demographics.gender !== undefined && demographics.gender !== null) {
      parts.push(String(demographics.gender));
    }
    index[demographics.provenance.rowUuid] = parts.join(", ");
  }

  if (facts.problems !== null && facts.problems.documented) {
    for (const problem of facts.problems.problems) {
      const status = problem.clinicalStatus !== undefined ? ` (${problem.clinicalStatus})` : "";
      index[problem.provenance.rowUuid] = `Problem: ${problem.display}${status}`;
    }
  }

  if (facts.medications !== null && facts.medications.documented) {
    for (const med of facts.medications.medications) {
      const conflict = med.hasConflict ? " (sources disagree on status)" : "";
      // Iterate the rich per-source rows (not the flattened provenance): each carries the
      // dose/date `generate` renders, and the claim cites this same row uuid. Without these
      // fields the judge cannot ground a dosed, dated med claim and drops it.
      for (const source of med.sources) {
        const dated = source.authoredOn !== undefined ? `, dated ${source.authoredOn}` : "";
        index[source.provenance.rowUuid] =
          `Medication: ${med.drug}; status ${med.status}${conflict}${dated}` +
          `${evidenceDosage(source.dosage)}; source ${source.sourceTable}`;
      }
    }
  }

  if (facts.allergies !== null && facts.allergies.documented) {
    for (const allergy of facts.allergies.allergies) {
      // Criticality must match what generate renders, else the judge drops a true claim
      // that states it (same drift the med-dosage evidence gap had).
      const crit = allergy.criticality !== undefined ? `, criticality ${allergy.criticality}` : "";
      index[allergy.provenance.rowUuid] = `Allergy documented: ${allergy.substance}${crit}`;
    }
  }

  if (facts.immunizations !== null && facts.immunizations.documented) {
    for (const i of facts.immunizations.immunizations) {
      // Status (e.g. "completed") must match renderImmunizations so a status claim grounds.
      const status = i.status !== undefined ? ` [${i.status}]` : "";
      const when = i.date !== undefined ? ` on ${i.date}` : "";
      index[i.provenance.rowUuid] = `Immunization on file: ${i.vaccine}${status}${when}`;
    }
  }

  if (facts.vitals !== null && facts.vitals.documented) {
    for (const v of facts.vitals.observations) {
      const unit = v.unit !== undefined ? ` ${v.unit}` : "";
      const when = v.effectiveDateTime !== undefined ? ` on ${v.effectiveDateTime}` : "";
      index[v.provenance.rowUuid] = `Vital sign: ${v.name} ${v.value}${unit}${when}`;
    }
  }

  if (facts.labs !== null && facts.labs.documented) {
    for (const l of facts.labs.observations) {
      const unit = l.unit !== undefined ? ` ${l.unit}` : "";
      const when = l.effectiveDateTime !== undefined ? ` on ${l.effectiveDateTime}` : "";
      index[l.provenance.rowUuid] = `Lab result: ${l.name} ${l.value}${unit}${when}`;
    }
  }

  return index;
}
