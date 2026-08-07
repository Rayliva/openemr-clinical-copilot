# Spec — Group derived labs by document + date by collection date (W2)

**Status:** building. Safety-critical (modifies the only write path). Physician feedback (2026-07-16):
derived lab values currently land as **N separate observation lines** on the encounter, each dated
"now" — hard to digest and chronologically wrong.

## Decision

- **Group by document via a shared `form_id`.** All of a document's committed values write into **one**
  `form_observation` form, so the encounter shows **one grouped entry per document** (e.g. one "Lab
  report" form containing its values) instead of N separate observation forms. (Chose shared `form_id`
  over parent/child FHIR panels — same encounter-level grouping, far less write-path complexity; the
  agent still reads the individual leaf values.)
- **Date by the document's collection date**, not the commit time, so a 2014 lab reads as 2014.

## How the model supports it (verified)

`ObservationService::saveObservation` calls `addForm()` (attaches a new encounter form) **only when
`form_id` is empty**; passing a `form_id` reuses that form with no new attachment. The observation
`date` is taken from the payload (`date` field), defaulting to now. So grouping = write the first value
(creates the form), reuse its `form_id` for the rest; dating = set the payload date to the collection
date.

## Behavior

- **Committing a document's values:** they share one `form_id` → one encounter entry. The first value
  creates the form + attaches it; the rest reuse the `form_id` (and its encounter), so no duplicate
  form entries.
- **Reuse on revisit:** if the document already has committed derived observations, reuse their existing
  `form_id` + encounter, so later additions/revisions **join the same group** rather than making a new
  one.
- **Supersede (slice 2) stays coherent:** a revised value voids the prior row (`entered-in-error`) and
  writes the new value **into the same `form_id`**; the group holds one active value per code plus the
  voided history.
- **Collection date:** the observation `date` = the document's collection date (from the extraction),
  passed through the commit request; fall back to now when absent or unparseable.

## Boundaries

- **Agent read path unchanged:** values remain individual leaf `form_observation` rows (category
  `laboratory`, coded), so `getLabs` reads them exactly as before — grouping is an encounter-display +
  provenance concern, not a change to what the agent sees.
- **All write gates + idempotency + supersede logic unchanged** — still keyed on `(document, code)`;
  only the `form_id` and `date` written differ.
- Ownership, citation-or-corrected, module-not-sidecar all hold.

## Components

- `DerivedWriteContext`: add `formId` (int; 0 = create a new form). `date` now carries the collection
  date (the controller resolves it).
- `DerivedObservationWriter::commit()`: when `ctx->formId > 0`, set `payload['form_id']` so the value
  joins the shared form; the supersede-written value uses the same `form_id`.
- `CommitReviewController`: resolve the document's `(form_id, encounter)` once — reuse an existing
  derived observation's, else let the first write create it and capture it for the rest; resolve the
  collection date from the request; write all values into the shared form.
- `ReviewCommitRequest`: parse an optional `collectionDate`.
- Review UI: send the draft's collection date (`doc.date`) as `collectionDate`.

## Acceptance criteria

- **AC1** Committing N accepted values from one document produces **one** encounter form entry (one
  `form_id`, one `addForm`) containing N observations — not N separate forms.
- **AC2** The observations are dated by the **collection date**, not the commit time.
- **AC3** Revisiting the document and accepting another value **joins the same form** (no second form
  entry).
- **AC4** Superseding a value voids the prior and writes the new value into the **same form**; `getLabs`
  still returns the current values.
- **AC5** All existing write-path unit tests pass unchanged (gates + idempotency intact).

## Open questions

- **Collection-date source/format** — the VLM extraction's date; validate + normalize to a datetime,
  fall back to now if missing/invalid (never write a bad date).
- **Cross-encounter reuse** — reuse the existing form's encounter (not the current "most recent") so a
  document's group stays on one encounter across revisits.
