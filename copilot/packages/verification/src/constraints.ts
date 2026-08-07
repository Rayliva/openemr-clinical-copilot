/**
 * Verification layer 3 — clinical-constraint engine.
 *
 * Deterministic checks over **structured facts only** (never prose), producing
 * safety findings for the pre-action surface (UC-4). It flags; it never decides
 * therapy or doses, and it never invents reference data (`verification-gate` rule).
 *
 * Scope (defensible subset): medication-status conflict, duplicate therapy by
 * therapeutic class, undocumented-allergy guard, and allergy contraindication by
 * name/class. NOT in v1: any computed drug-drug-interaction or renal-dosing rule —
 * those require reference data we will not fabricate. See
 * docs/specs/clinical-constraint-engine.md for the documented limitations.
 */

export type ConstraintSeverity = "warning" | "info";

export type ConstraintCode =
  | "medication-status-conflict"
  | "duplicate-therapy"
  | "allergy-status-unknown"
  | "allergy-contraindication";

/** One medication as the engine consumes it (adapted from a reconciled med). */
export interface ConstraintMed {
  readonly drug: string;
  readonly status: "active" | "inactive" | "conflicted";
  readonly hasConflict: boolean;
  /** Provenance row uuids backing this med (used to ground findings). */
  readonly sourceRefs: readonly string[];
}

/**
 * Documented allergies (with grounding refs), or the not-documented sentinel. `reason`
 * distinguishes a chart checked and found empty (`absent`) from a read that FAILED
 * (`unavailable`) — the latter must never be treated as safer than the former
 * (`verification-gate` rule: a failed read is not a negative finding).
 */
export type ConstraintAllergies =
  | { readonly documented: true; readonly substances: readonly { readonly name: string; readonly ref: string }[] }
  | { readonly documented: false; readonly reason?: "absent" | "unavailable" };

export interface ConstraintFacts {
  readonly medications: readonly ConstraintMed[];
  readonly allergies: ConstraintAllergies;
}

export interface ConstraintFinding {
  readonly code: ConstraintCode;
  readonly severity: ConstraintSeverity;
  readonly message: string;
  /** Row uuids grounding this finding; empty only for absence findings. */
  readonly sourceRefs: readonly string[];
}

/**
 * Small curated drug → therapeutic-class map. Intentionally minimal (demo drug set +
 * common classes); unknown drugs are simply un-classed and not checked — never
 * treated as safe. Growing this is a data change, not a logic change.
 */
const DRUG_CLASS: Readonly<Record<string, string>> = {
  lisinopril: "ACE inhibitor",
  enalapril: "ACE inhibitor",
  ramipril: "ACE inhibitor",
  benazepril: "ACE inhibitor",
  lipitor: "statin",
  atorvastatin: "statin",
  simvastatin: "statin",
  rosuvastatin: "statin",
  crestor: "statin",
  pravastatin: "statin",
  metformin: "biguanide",
  glucophage: "biguanide",
  amoxicillin: "penicillin",
  ampicillin: "penicillin",
  penicillin: "penicillin",
  ibuprofen: "NSAID",
  naproxen: "NSAID",
  aspirin: "NSAID",
};

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Map a free-text drug/allergen name to a therapeutic class. Real OpenEMR names carry
 * qualifiers, plurals, salts, and strengths ("Penicillin VK", "Penicillins",
 * "Amoxicillin 500 MG Oral Capsule"), so an exact whole-string lookup silently misses
 * a real contraindication. Match a known class-key as a substring of the normalized
 * name; the keys are distinctive multi-character drug names, so false positives are
 * negligible. Exact-match keys still win via the fast path.
 */
function classOf(name: string): string | undefined {
  const n = normalize(name);
  const exact = DRUG_CLASS[n];
  if (exact !== undefined) {
    return exact;
  }
  for (const key of Object.keys(DRUG_CLASS)) {
    if (n.includes(key)) {
      return DRUG_CLASS[key];
    }
  }
  return undefined;
}

/** A med the physician might currently be taking (active, or conflicted so possibly active). */
function possiblyActive(m: ConstraintMed): boolean {
  return m.status === "active" || m.status === "conflicted";
}

function checkConflicts(meds: readonly ConstraintMed[]): ConstraintFinding[] {
  return meds
    .filter((m) => m.hasConflict)
    .map((m) => ({
      code: "medication-status-conflict" as const,
      severity: "warning" as const,
      message: `${m.drug} is marked active in one source and inactive/stopped in another — confirm the patient's current status before renewing.`,
      sourceRefs: [...m.sourceRefs],
    }));
}

function checkDuplicateTherapy(meds: readonly ConstraintMed[]): ConstraintFinding[] {
  const active = meds.filter(possiblyActive);
  const byClass = new Map<string, ConstraintMed[]>();
  for (const m of active) {
    const cls = classOf(m.drug);
    if (cls === undefined) {
      continue;
    }
    const group = byClass.get(cls);
    if (group === undefined) {
      byClass.set(cls, [m]);
    } else {
      group.push(m);
    }
  }

  const findings: ConstraintFinding[] = [];
  for (const [cls, group] of byClass) {
    const distinct = new Map(group.map((m) => [normalize(m.drug), m]));
    if (distinct.size < 2) {
      continue;
    }
    const members = [...distinct.values()];
    const drugs = members.map((m) => m.drug);
    const drugList =
      drugs.length === 2
        ? drugs.join(" and ")
        : `${drugs.slice(0, -1).join(", ")}, and ${drugs[drugs.length - 1]}`;
    findings.push({
      code: "duplicate-therapy",
      severity: "warning",
      message: `Possible duplicate therapy: ${drugList} are the same class (${cls}) — review for overlap.`,
      sourceRefs: members.flatMap((m) => [...m.sourceRefs]),
    });
  }
  return findings;
}

function checkAllergies(facts: ConstraintFacts): ConstraintFinding[] {
  if (!facts.allergies.documented) {
    const unavailable = facts.allergies.reason === "unavailable";
    return [
      {
        code: "allergy-status-unknown",
        severity: unavailable ? "warning" : "info",
        message: unavailable
          ? "Allergy data could not be retrieved this turn — allergy status is unverified; do not treat as no-known-allergies before prescribing."
          : "No allergies are documented for this patient — treat as unknown, not confirmed absent, before prescribing.",
        sourceRefs: [],
      },
    ];
  }

  const substances = facts.allergies.substances;
  const findings: ConstraintFinding[] = [];
  for (const m of facts.medications.filter(possiblyActive)) {
    const medClass = classOf(m.drug);
    for (const s of substances) {
      const matchesByName = normalize(s.name) === normalize(m.drug);
      const matchesByClass = medClass !== undefined && classOf(s.name) === medClass;
      if (matchesByName || matchesByClass) {
        findings.push({
          code: "allergy-contraindication",
          severity: "warning",
          message: `${m.drug} may conflict with a documented allergy to ${s.name} — verify before prescribing.`,
          sourceRefs: [...m.sourceRefs, s.ref],
        });
      }
    }
  }
  return findings;
}

const SEVERITY_ORDER: Readonly<Record<ConstraintSeverity, number>> = { warning: 0, info: 1 };

/**
 * Run every constraint check over the structured facts and return findings in a
 * deterministic order (warnings before info, then by code, then by first ref).
 */
export function checkConstraints(facts: ConstraintFacts): ConstraintFinding[] {
  const findings = [
    ...checkConflicts(facts.medications),
    ...checkDuplicateTherapy(facts.medications),
    ...checkAllergies(facts),
  ];

  return findings.sort((a, b) => {
    if (SEVERITY_ORDER[a.severity] !== SEVERITY_ORDER[b.severity]) {
      return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    }
    if (a.code !== b.code) {
      return a.code.localeCompare(b.code);
    }
    return (a.sourceRefs[0] ?? "").localeCompare(b.sourceRefs[0] ?? "");
  });
}
