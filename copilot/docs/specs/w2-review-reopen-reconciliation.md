# Spec — Document-review re-open reconciliation + revise/supersede (W2)

**Status:** designed, implementation deferred for physician review + Site B deploy.
**Why deferred:** this changes the **only write in the system** (it voids and rewrites chart
data). Per `.claude/rules/w2-document-ingestion-writes.md` and `.claude/rules/verification-gate.md`
the write path is safety-critical and stays serial; it should land with the user available to review
the supersede semantics and to deploy/verify on Site B. This spec captures the agreed design so it is
not lost.

Extends: `w2-inline-source-viewer.md`, the write path in `w2-ingest-write-path.md`
(`DerivedObservationWriter`, `CommitReviewController`), and the shared renderer `review-render.js`.

## Problem

Today the document-review UI is stateless with respect to what the physician already did. Re-opening a
document re-fetches the raw AI extraction and shows every row as undecided — even values already
committed to the chart. Two consequences the user flagged:

1. **"Discard" and "not accepted" are indistinguishable to the chart.** Both leave the value unwritten;
   neither is persisted; a reload forgets both. "Discard" is only a client-side affordance today.
2. **A committed value is invisible on re-open.** If the physician accepted Creatinine and corrected
   Potassium 4.5→4.6 and committed them, re-opening still shows the AI's original values as undecided,
   with no indication that they are on the chart or were physician-overridden.

## Decisions (from the user, 2026-07-15)

- **Revise + supersede** (not lock): a committed row stays editable; re-committing a *changed* value
  **replaces** the prior Observation rather than appending a duplicate.
- **Remember committed only**: re-open reflects on-chart (committed) values. Discards stay per-session
  (no new persistence for rejections in v1).

## Behavior

On opening/re-opening a document's review, for each extracted result row:

- Compute the derived **code** exactly as the writer does: `LOINC:<loinc>` when a LOINC is present,
  else the `testName` (must match `DerivedObservationWriter::buildPayload`'s `code`).
- Look up the **active** committed derived Observation for `(documentId, code)` (the `derivedFrom`
  link `ob_documentationof_table='documents' AND ..._table_id=documentId`, excluding voided rows).
- **If committed:**
  - Render the row in an **"on chart"** state: filled ✓ + an "on chart" badge; the value input is
    **pre-filled with the committed value** (not the AI value).
  - When the committed value **differs from the AI-extracted value**, show a
    **"physician-corrected — AI read `<aiValue>`"** annotation (the AI value is still available from
    the draft, so no extra storage is needed to show the override).
  - The row is editable. Editing the value marks it **"revised"** (will supersede on commit).
- **If not committed:** behave exactly as today (undecided; accept/discard/edit).

On **Commit**:

- **New accepted rows** → written (as today).
- **Committed row, value unchanged** → no-op (idempotent skip; nothing sent, or writer skips).
- **Committed row, value changed** → **supersede**: the prior active Observation for `(documentId,
  code)` is **voided** (`ob_status='entered-in-error'`, not deleted — auditable) and the new value is
  written as a fresh `final` Observation with physician-corrected provenance and the same `derivedFrom`
  link. Reported as a distinct **"updated N (superseded prior)"** count.

## Boundaries (unchanged safety guarantees)

- **Scope:** only derived Observations for *this* document (the `derivedFrom` link). Never touches
  other documents' or manually-entered Observations.
- **Ownership re-checked at the write boundary** (as in `CommitReviewController`); pid derived from the
  document, never the request.
- **All existing write gates hold**: citation-present-unless-physician-corrected, non-empty value,
  module-not-sidecar. Supersede does not weaken any gate — a revised value is physician-corrected by
  definition, so it satisfies gate #2.
- **Supersede is physician-driven and auditable**: the old row is voided (kept for history), the void +
  write are logged (counts only, no PHI values), consistent with `phi-and-secrets`.
- **No new write bypasses the verification gate or the module boundary.** The sidecar still never
  writes.
- **Idempotent:** re-committing the same value is a no-op; the identity of a derived value is
  `(documentId, code)` with at most one **active** Observation.

## Components

1. **`DerivedObservationWriter` supersede** (safety-critical, serial, TDD):
   - Add a **pure decision** function (mirrors the existing `buildPayload` pure/IO split) that, given
     the existing active row for `(documentId, code)` (its value or none), returns
     `Write | SkipDuplicate | Supersede(priorId)`. Unit-testable with no DB.
   - `commit()` performs the IO around it: look up active row (filtering `ob_status<>'entered-in-error'`),
     apply the decision (void prior via `ob_status='entered-in-error'` UPDATE, then insert new + set
     `derivedFrom`).
   - Add `DerivedWriteStatus::Superseded`.
2. **Committed-read endpoint** (module, ownership-scoped) — e.g. `public/committed-review.php` +
   `CommittedReviewController`: given a document FHIR id, return the active committed derived values
   keyed by code: `{ committed: { "<code>": { value, unit, physicianCorrected } } }`. Read-only.
3. **`review-render.js` reconciliation**: the host pages (`review.php`, `review-widget.php`) fetch the
   committed map and pass it into `renderDoc(doc, commit, committed)`; the renderer annotates rows
   (on-chart state, committed value, "AI read X" badge) and the commit flow sends revised committed
   rows as supersede.
4. **`CommitReviewController` reporting**: include a `superseded` count; the toast reads
   "Wrote N, updated M (superseded prior), skipped K, rejected J".

## Acceptance criteria

- **AC1** Given a committed derived value for `(doc, code)`, re-opening shows the row with a filled ✓,
  an "on chart" badge, and the **committed** value pre-filled.
- **AC2** Given a committed value that differs from the AI-extracted value, the row shows
  "physician-corrected — AI read `<aiValue>`".
- **AC3** Committing an **unchanged** committed row writes nothing new (no duplicate Observation).
- **AC4** Editing a committed value and committing **voids** the prior Observation
  (`ob_status='entered-in-error'`) and writes exactly **one** new active Observation with the new value;
  the chart shows a single active derived value for that `(doc, code)`.
- **AC5** Superseding preserves history (the voided row still exists) and is logged (counts only).
- **AC6** All pre-existing write-gate tests still pass unchanged (no gate weakened).
- **AC7** A never-committed row behaves exactly as before (undecided; accept/discard/edit).
- **AC8** Discards remain per-session (no persisted rejection in v1).

## Open questions / notes

- **Void representation:** decided `ob_status='entered-in-error'` (FHIR-correct, auditable) over hard
  delete. All committed-value lookups (idempotency + read endpoint) must filter voided rows, else a
  re-commit of a previously-voided value would wrongly skip.
- **Code matching** relies on the JS computing `code` identically to PHP (`LOINC:<loinc>` | `testName`).
  Keep the two in sync; a future refactor could have the endpoint return a match key.
- **Encounter:** superseding writes to the patient's most-recent encounter (same as the current
  commit path); the voided row keeps its original encounter.
- **Multiple pre-existing duplicates** (from the current append-on-change behavior before this lands):
  the supersede lookup should void *all* active rows for `(doc, code)` before writing the new one, so
  the invariant "one active per (doc, code)" is restored on first revise.
