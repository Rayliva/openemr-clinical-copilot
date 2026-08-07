# Spec: Problems + Allergies mapping (provenance + absence)

Traces to: PRD feature #4, UC-1/UC-2 (problem list), UC-4 (allergies). Extends the
provenance-tagged mapping pattern (`fhir-read-patient.md`) to two more resources.

## Live shapes (from OpenEMR, confirmed)
- **Condition** (problems): `code.text` (often just text, e.g. "diabetes", no
  coding — matches AUDIT ICD-9/empty-code findings), `clinicalStatus.coding[0].code`
  (e.g. "active"). Source table: `lists`.
- **AllergyIntolerance**: Susan has **zero** — the "absence ≠ negative" case
  (`USERS.md`, `AUDIT.md §4.5`). When present: `code.text`,
  `clinicalStatus`, `reaction`/`criticality` may be absent.

## Behavior

### Problems (`mapFhirCondition`)
- Map a Condition → `Problem`: `{ display, clinicalStatus?, provenance }` where
  `display` = `code.text` (or a coding display if text is absent),
  `provenance = { sourceTable: "lists", rowUuid: <id>, fetchedAt }`.
- `mapFhirConditions(bundle)` → `Problem[]` from a searchset Bundle.

### Allergies (`mapFhirAllergies`)
- Map an AllergyIntolerance → `Allergy`:
  `{ substance, reaction?, criticality?, clinicalStatus?, provenance }` with
  `provenance.sourceTable = "lists"`.
- **Absence is explicit.** `mapFhirAllergies` returns a discriminated result:
  `{ documented: true, allergies: Allergy[] }` when ≥1 exists, or
  `{ documented: false }` when the bundle is empty — so the agent says "none
  documented," never "no allergies / safe" (`AUDIT.md §4.5`, provenance-and-grounding
  rule).

## Acceptance criteria
1. `mapFhirCondition` maps display + clinicalStatus + provenance (`lists`).
2. A Condition with only `code.text` still maps (no coding required).
3. `mapFhirAllergies` on a non-empty bundle → `{documented:true, allergies:[…]}`
   with provenance.
4. `mapFhirAllergies` on an **empty** bundle → `{documented:false}` (NOT an empty
   allergy list presented as "none").
5. Malformed resource → typed `SnapshotMappingError`.

## Boundaries
- No medications here (reconciliation is its own iteration).
- No snapshot assembly/cache yet.
