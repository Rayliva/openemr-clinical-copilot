# Spec — Stateful document-review workflow (W2)

**Status:** designed, awaiting sign-off before build. Safety-critical (touches the write path +
adds the first persisted review state).

Supersedes the "remember committed only" decision in `w2-review-reopen-reconciliation.md` — we now
remember **discards too** — and folds that spec's re-open reconciliation + revise/supersede in.

## Problem (physician feedback, 2026-07-16)

1. **Discard does nothing and isn't remembered.** Accept writes an Observation; Discard is a
   client-only visual with no persistence — a reload forgets it, and a discarded value keeps
   re-appearing as undecided.
2. **The "Review Documents" launcher never goes away**, even after the physician has dispositioned
   every value. It should disappear once a document is fully reviewed — but the review must stay
   reachable afterward from a permanent place in the chart.
3. *(Shipped separately, `cb3455b`)* the zoom highlight showed two orange boxes (clicked + hovered).

## Decisions (from the user)

- **Persist every value's disposition.** Accept → Observation (as today) **and** an "accepted"
  record; **Discard → a "dismissed" record.** Discards are remembered.
- **A document is "reviewed" once every extracted value has a disposition** (accepted or discarded).
- **Permanent home = the OpenEMR Documents section:** each document gets an **Edit/Review** action
  that reopens the review scoped to that document. Reopening shows **committed**, **physician-
  overridden** ("AI read X → Y"), and **discarded** values, plus any still-undecided ones — and lets
  the physician **change what was committed** (edit + re-commit **supersedes** the prior Observation,
  per the reconciliation spec).
- Once a document is reviewed, the **floating notification launcher stops counting it**; when nothing
  is left to review the launcher disappears.

## Persisted state (behavior level)

A small module-owned store records, per document, each extracted value's disposition:
`{ document, valueKey, disposition: accepted | discarded, committedObservation?, aiValue,
physicianCorrected, user, timestamp }`, one live record per `(document, valueKey)` (a revise
updates it). From it we derive: a value's current disposition, and whether a document is **fully
reviewed** (a disposition exists for every extracted value). `valueKey` = the derived code
(`LOINC:<loinc>` | testName), matching the write path. Accepted values also persist as Observations
(the existing write path is unchanged and remains the source of truth for chart data).

## Behavior

### Disposition + commit
- The review UI shows per-value **Accept / Discard** (as today) plus, on reopen, each value's current
  state: **on chart** (committed), **dismissed** (discarded, struck-through), or **undecided**.
- **Commit** persists dispositions for every decided value: accepted → write/idempotent/supersede the
  Observation + record "accepted"; discarded → record "dismissed" (no Observation). Undecided values
  are left undecided (not counted as reviewed).
- **Revise (reconciliation spec):** a committed value stays editable; editing + re-commit **voids the
  prior Observation** (`ob_status='entered-in-error'`, auditable) and writes the new value; unchanged
  re-commit is a no-op. Physician-corrected values show "AI read X → Y".
- All existing write-path gates hold (citation-or-corrected, ownership, module-not-sidecar); the
  disposition store never bypasses them.

### Reviewed state + launcher lifecycle
- A document is **reviewed** when a disposition exists for **every** extracted value.
- The chart-open launcher shows only documents that are **detected AND not fully reviewed**. The
  agent detects documents (FHIR); the module owns review state; the **widget composes** the two
  (detected ids − reviewed ids) and shows the launcher + count only for the remainder — so it
  disappears once everything is reviewed.

### Permanent entry — Documents section
- Each document in the patient's Documents area gets an **Edit/Review with Co-Pilot** action that
  opens the review scoped to that document (`review.php?pid=…&documentId=…`) in **revisit mode**:
  committed/overridden/discarded/undecided all shown, editable, re-commit supersedes.
- This is reachable **regardless of** the launcher, so review is never lost after the notification
  clears.

## Boundaries

- Read-only sidecar unchanged; **only the OpenEMR module writes** (Observations + the disposition
  store). No new OAuth write scope.
- The disposition store holds decisions + provenance, **not** chart truth — Observations remain the
  chart source of truth; a discarded value is a recorded decision, never a chart record.
- Scope is per-document; never fans out across patients; ownership re-checked at every write/read.
- Deterministic + auditable: supersede voids (not deletes) the prior row; decisions are logged
  (counts, no PHI values).

## Acceptance criteria

- **AC1** Discarding a value and reloading shows it as **dismissed** (struck-through), not undecided.
- **AC2** A document with every value accepted-or-discarded is **reviewed**; the launcher no longer
  counts it, and disappears when no un-reviewed documents remain.
- **AC3** The Documents section shows an **Edit/Review** action per document that reopens the review
  scoped to that document, even after the launcher is gone.
- **AC4** Reopening shows committed (on-chart), physician-overridden ("AI read X → Y"), and discarded
  (dismissed) values, plus undecided ones.
- **AC5** Editing a committed value + re-commit **supersedes** the prior Observation (one active
  Observation for that value; prior voided, not duplicated).
- **AC6** All pre-existing write-gate tests pass unchanged.
- **AC7** Ownership: a non-owned patient's document review/write is refused.

## Build slices (each independently testable; safety-critical, serial)

1. **Disposition store + endpoint** — module table + write of accepted/discarded decisions; extend
   the commit endpoint to accept discards; unit tests (pure decision + persistence).
2. **Writer supersede** — `DerivedObservationWriter` gains void-and-rewrite + `Superseded` status
   (from the reconciliation spec), TDD.
3. **Reviewed-state read + launcher composition** — module endpoint returns reviewed doc ids; widget
   subtracts from detected to drive the launcher; agent `/documents/status` returns detected ids.
4. **Re-open reconciliation UI** — `review-render.js` renders committed/overridden/discarded state +
   the revise flow; host pages fetch the disposition + committed maps.
5. **Persistent revisit entry** — `review.php?pid&documentId=` opens ONE document's review in revisit
   mode (deep-linkable), and the in-chart launcher persists as a muted "Reviewed Documents" button
   (no dot) once everything is reviewed, so the review stays reachable after the notification retires.
   *(Kept module-owned: OpenEMR's Documents page is a standalone core template rendering a
   server-generated tree, so a per-document button IN that tree would require editing core — against
   the thin-module-footprint architecture. Flagged to the user as an optional small core edit.)*

## Open questions

- **Documents-section integration** — RESOLVED: OpenEMR's Documents page (`templates/documents/
  general_list.html`) is a standalone core template with a server-generated tree, so a button inside
  the tree needs a core edit. Kept the entry module-owned (deep-link + muted persistent launcher);
  a literal in-tree button remains an option if the user accepts the small core change.
- **valueKey stability** — a value with no LOINC keys on `testName`; confirm extraction test names are
  stable across re-extraction so a disposition still matches on reopen.
