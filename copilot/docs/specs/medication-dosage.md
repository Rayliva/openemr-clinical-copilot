# Spec — Medication dosage in the meds tool

Status: **Approved, in build** (branch `feat/floating-agent`). Closes a
`chart-data-serviceable` gap surfaced live: a physician asked for Albuterol's dose and the
agent answered "not documented," when in fact our tool never fetched it. Governed by
`.claude/rules/provenance-and-grounding.md`, `.claude/rules/typescript-standards.md`.

## Problem

`mapFhirMedicationRequest` (`packages/snapshot/src/medications.ts`) parses only `status`,
`intent`, and the drug name from each FHIR `MedicationRequest`. It **drops
`dosageInstruction`** entirely. OpenEMR's `FhirMedicationRequestService` *does* emit
`dosageInstruction` — SIG free-text (`.text`), `doseAndRate[].doseQuantity`, and `route` —
whenever the prescription carries it (`src/Services/FHIR/FhirMedicationRequestService.php`
~L255–313). So "dosage not documented" is our tool's blind spot, not the record's — and per
the grounding rules the model can only state what it is given, so it (correctly, but
misleadingly) reports absence.

## Behavior

- The medication mapper extracts an optional **`dosage`** from `dosageInstruction[0]`:
  - `text` — the SIG / free-text instruction (e.g. "2 puffs every 4 hours as needed"). Primary.
  - `dose` — `doseAndRate[].doseQuantity` rendered as `"{value} {unit}"` (unit optional).
  - `route` — `route.text`, else the first `route.coding[].display`.
  - If none are present, `dosage` is **absent** (not an empty object) — nothing to state.
- `dosage` rides on **`MedicationSource`** (it is a per-prescription attribute), so it flows
  through `reconcileMeds` unchanged and is reachable via each `ReconciledMedication.sources`.
  No new field on `ReconciledMedication`.
- The fact renderer (`claudeGenerate.ts renderMedications`) includes the dosage inline on the
  source that carries it, so the model can cite and state it against that source's row.
- Absence is still honest: a med with no dosage on file renders without a dose, and the model
  reports it as not documented **for that medication** — never fabricates a dose from priors
  (`provenance-and-grounding`, and the existing eval `grounding no-invented-dose` still holds).

## Boundaries

- **Read-only, additive.** No change to reconciliation logic, conflict detection, the
  constraint engine, the verification gate, or the `/chat` contract. `dosage` is optional
  metadata on a source.
- Only `dosageInstruction[0]` is read (the first instruction). Multi-instruction regimens
  (rare in the seed data) surface their first line; documented as a known limitation, not a
  silent drop.
- No dose **interpretation** (no "is this dose safe?" — that would be a new safety surface).
  We surface what's recorded, nothing more.
- Requires a **local agent restart** to take effect; ships to prod only on the next deploy.

## Acceptance criteria

1. `mapFhirMedicationRequest` on a resource with `dosageInstruction[0].text` returns a source
   whose `dosage.text` equals that SIG.
2. `doseAndRate[0].doseQuantity {value, unit}` maps to `dosage.dose = "{value} {unit}"`;
   value-only maps to just the value.
3. `route.coding[0].display` (or `route.text`) maps to `dosage.route`.
4. A resource with **no** `dosageInstruction` (all existing tests) yields a source with **no**
   `dosage` property — existing tests and reconciliation are unchanged.
5. `dosage` survives `reconcileMeds` and is present on the reconciled med's `sources[]`.
6. The rendered FACTS for a med with a dosage include the SIG/dose/route text so the model can
   answer "what is the dose of X" grounded in that source row.
7. The `grounding no-invented-dose` eval still passes (no fabricated dose when none is on file).
