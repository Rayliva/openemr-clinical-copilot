# Spec: Clinical-constraint engine (verification layer 3)

Traces to: the **domain-constraint enforcement** graded requirement
(`docs/week1-requirements.md`) and **UC-4** (pre-action safety surface). This is
verification layer 3, sitting after the citation check (layer 1). It reads
**structured facts only, never prose** (`verification-gate` rule).

Scope decision (confirmed with user, 2026-07-08): **defensible subset** — enforce
deterministically only what the structured data supports; do NOT ship an invented
drug-drug-interaction or renal-dosing database. Document limitations explicitly.

## Behavior

`checkConstraints(facts) → ConstraintFinding[]` — a pure function over a minimal
structured input the engine defines (keeping `@copilot/verification` decoupled from
`@copilot/snapshot`; the graph adapts snapshot facts to this shape).

### Input (`ConstraintFacts`)
- `medications: ConstraintMed[]` — `{ drug, status: "active"|"inactive"|"conflicted",
  hasConflict, sourceRefs: string[] }` (refs are provenance row uuids).
- `allergies: { documented: true, substances: {name, ref}[] } | { documented: false }`.

### Finding (`ConstraintFinding`)
`{ code, severity: "warning"|"info", message, sourceRefs: string[] }`. Messages are
honest and never invent a fact; `sourceRefs` ground the finding in retrieved rows
(empty only for absence findings, which are not model claims).

### Checks (deterministic)
1. **`medication-status-conflict`** (warning) — one finding per med with
   `hasConflict`. Cites **both** the med's source rows. (Susan's Lisinopril.)
2. **`duplicate-therapy`** (warning) — among meds that are `active` or `conflicted`
   (possibly-active), group by **therapeutic class** via a small curated
   drug→class map; ≥2 *distinct* drugs sharing a class → one finding citing the
   involved rows. Unknown drugs have no class and are not checked (limitation).
3. **`allergy-status-unknown`** (info) — when `allergies.documented === false`, one
   finding: "no allergies documented — treat as unknown, not confirmed absent"
   (`AUDIT.md §4.5`; absence ≠ safe). `sourceRefs: []` (grounded in absence).
4. **`allergy-contraindication`** (warning) — when allergies ARE documented, for each
   active/conflicted med whose drug **name or class** matches a documented allergy
   substance (by name or shared class), one finding citing the med row **and** the
   allergy row.

### Ordering
Findings sorted deterministically: warnings before info, then by `code`, then by
first `sourceRef` — stable regardless of input order.

## Acceptance criteria
1. A conflicted med → exactly one `medication-status-conflict` warning citing both rows.
2. Two active drugs in the same class (e.g. two statins) → one `duplicate-therapy`
   warning citing both; two drugs in *different* classes → none.
3. `allergies.documented:false` → one `allergy-status-unknown` info with empty refs.
4. Documented penicillin allergy + active amoxicillin (both penicillin-class) → one
   `allergy-contraindication` warning citing the med and the allergy rows.
5. Documented allergy with no matching med → no contraindication finding.
6. Susan's real facts (Lisinopril conflict, Lipitor/Metformin active, no allergies)
   → exactly: one conflict warning + one `allergy-status-unknown` info; **no**
   duplicate-therapy, **no** contraindication.
7. Output ordering is stable regardless of input order.

## Boundaries / documented limitations
- **No invented reference data.** The drug→class map is small and curated (demo drug
  set + common classes); unknown drugs are silently un-classed (not flagged as safe —
  simply not checked). Brand↔generic is covered only where the map lists both.
- **No drug-drug interaction engine, no renal-dosing rules** in v1. Interaction/renal
  concerns are surfaced only if the problem list already documents them (a later
  iteration once the problems tool is wired) — the engine never computes them.
- **The engine flags; it does not decide therapy or doses** (UC-4 boundary). It is
  decision support by retrieval.
- Findings are computed from structured facts and do **not** pass the citation check
  (that gate is for model claims); they are appended as a distinct safety section.

## Open questions
- None blocking. The class map's coverage is intentionally minimal for v1 and can
  grow; each addition is a data change, not a logic change.
