# Spec: Medication reconciliation (UC-3)

Traces to: **UC-3** (medication reconciliation) and UC-4 (pre-action safety surface,
which consumes the reconciled list). Extends the provenance-tagged mapping pattern
(`snapshot-problems-allergies.md`) to FHIR `MedicationRequest`, then reconciles the
two disagreeing OpenEMR sources into one list with conflicts surfaced.

Why an agent (not a widget): OpenEMR stores meds in **two tables that disagree**
(`lists WHERE type='medication'` vs `prescriptions`); "current medications" depends
on which is read (`AUDIT.md §4.1`). Reconciliation is reasoning over conflicting
structured records and *explaining* the conflict — patient-safety, not cosmetic.

## Live shapes (from OpenEMR, confirmed against Susan Underwood, pid 2)

FHIR `MedicationRequest?patient=<id>` unions both source tables via `intent`:
- `intent: "order"` → the **`prescriptions`** table.
- `intent: "plan"`  → the **`lists`** table.

Each entry: `medicationCodeableConcept.text` (drug name; **no RxNorm coding** in this
data — dedupe on normalized name), `status` (`"active"` / `"stopped"` / …), `id`
(row uuid). Susan's real bundle (4 entries):

| drug | intent → table | status |
|------|----------------|--------|
| Lisinopril | order → `prescriptions` | active |
| Metformin  | plan → `lists`         | active |
| Lipitor    | plan → `lists`         | active |
| Lisinopril | plan → `lists`         | **stopped** |

So **Lisinopril conflicts**: active in `prescriptions`, stopped in `lists` — the
exact UC-3 case. Metformin and Lipitor exist only in `lists`, both active.

## Behavior

### `mapFhirMedicationRequest(resource, fetchedAt) → MedicationSource`
- `drug` = `medicationCodeableConcept.text` (or a coding display if text absent;
  else `"(unspecified medication)"`).
- `sourceTable` derived from `intent`: `order → "prescriptions"`, `plan → "lists"`.
- `status` = raw FHIR status string; `active` = `status === "active"`.
- `provenance = { sourceTable, rowUuid: id, fetchedAt }`.
- Missing/unknown `intent`, or a non-`MedicationRequest` resource → typed
  `SnapshotMappingError` (fix the source, don't guess a table).

### `mapFhirMedications(bundle, fetchedAt) → MedicationSource[]`
- Maps every entry of a searchset Bundle. Empty bundle → `[]`.

### `reconcileMeds(sources) → ReconciledMedication[]` (pure)
- Group by **normalized drug name** (`trim().toLowerCase()`).
- Per group → one `ReconciledMedication`:
  - `drug` = the first-seen original-cased name.
  - `sources` = all contributing `MedicationSource`s (input order preserved).
  - `provenance` = every contributing row's provenance (so a conflict claim can
    cite **both** sources).
  - `status`: `"active"` if all sources active; `"inactive"` if none active;
    `"conflicted"` if sources disagree on active-ness.
  - `hasConflict` = `status === "conflicted"`.
- Output ordered by normalized drug name (deterministic, FHIR-order-independent).

### `mapAndReconcile` result (absence-aware, for the tool)
- `{ documented: true, medications: ReconciledMedication[] }` when ≥1 entry, else
  `{ documented: false }` — never an empty list presented as "no medications /
  none," mirroring allergies (`provenance-and-grounding`).

## Acceptance criteria
1. `mapFhirMedicationRequest` maps drug + status + `active` + provenance, deriving
   `prescriptions` from `intent:order` and `lists` from `intent:plan`.
2. Unknown/missing `intent` → `SnapshotMappingError`.
3. `reconcileMeds` on Susan's 4 entries → **3** reconciled meds; Lisinopril is
   `status:"conflicted"`, `hasConflict:true`, with provenance for **both** the
   `prescriptions` (active) and `lists` (stopped) rows.
4. Metformin and Lipitor reconcile to single `status:"active"` entries,
   `hasConflict:false`.
5. Two sources that agree (both active, or both inactive) → no conflict.
6. Output is stable regardless of input order (sorted by normalized name).
7. Empty bundle via the absence-aware wrapper → `{ documented:false }`.

## Boundaries
- **No clinical judgement here** — reconciliation surfaces the conflict; it does not
  decide which source is right, pick a winner, or drop the inactive row (UC-3
  failure modes: silently trusting one source, hiding a conflict, dropping a stopped
  med the physician needs to see).
- Dedupe is name-based only (no RxNorm in this data); documented limitation.
- Duplicate-therapy / allergy / interaction checks are the **constraint engine**
  (verification layer 3), a separate iteration — this only produces the reconciled
  structured facts they consume.

## Open questions
- None blocking. Name-normalization is exact-match after low/trim; brand↔generic
  equivalence (Lipitor↔atorvastatin) is explicitly out of scope for v1 dedupe and
  noted as a limitation.
