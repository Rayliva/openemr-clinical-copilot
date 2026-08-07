# Spec — W2 document-ingestion WRITE path (slice 2f)

> The **only write in the system**. Turns a physician-confirmed extracted value into a chart record.
> Constrained by `.claude/rules/w2-document-ingestion-writes.md` (canonical schema; sidecar never
> writes; no commit without physician confirm + citation; idempotent `derivedFrom`; extract once) and
> `w2-PRD.md` feature #3. Read the rule before implementing — every clause below traces to it.
>
> **Status: BUILT + live-verified (2026-07-14).** `DerivedObservationWriter` (gates + idempotency +
> post-insert `derivedFrom`), `ReviewCommitRequest`, the `commit-review` endpoint
> (`CommitReviewController`), and the review-UI accept/discard/edit + Commit controls are all in;
> verified end-to-end against the real DB (FHIR-id resolution → write → idempotent re-commit → a
> `laboratory` Observation). Follow-on: intake-form value writes (v1 is lab values only).

## Behavior (what the physician does, what the system does)

### Review UI — per-value controls (in `review-render.js`, shared by the modal + `review.php`)
Each extracted value row gains:
- **Accept ✓ / Discard ✗** (default: neither — an untouched row is *not* written).
- An **editable value** field (inline). Editing flips the row's citation to `physician-corrected`.
- A **Commit reviewed values** button that POSTs the physician's decisions to the module.

Discard → nothing written. Accept (unedited) → written as a cited Observation. Accept (edited) →
written as a `physician-corrected` Observation.

### The three gates (ALL required for any single value to be written)
1. **Physician confirm** — only rows explicitly Accepted commit. No upload-time or automatic write.
2. **Citation present** — the value must carry a box-match citation. A `matchState` of "not found on
   page" is **forced review** and cannot be Accepted until the physician edits/confirms it (which
   makes it `physician-corrected`). Never a silent fill.
3. **The OpenEMR module writes — never the sidecar.** The agent only *proposed* the draft; the
   module (`oe-module-copilot`, running in the physician's authenticated session) performs the write.
   No OAuth **write** scope is requested (the read-only-client invariant holds).

### What gets written
Each accepted value → a FHIR **Observation** for the bound patient, **`derivedFrom`** the source
`DocumentReference`, carrying: the value + unit + reference range + abnormal flag, the LOINC/code if
known, `status = final`, and a provenance extension recording `co-pilot-derived`, the source document
content hash, the citation (page box or `page-approximate`), and `physician-corrected` when edited.

### Idempotency + traceability (`w2-document-ingestion-writes`)
- Keyed by **document content hash + the value's citation id**. Re-committing the same document/value
  is a **no-op** (find-existing-by-key → skip) — no duplicate Observation, no silent overwrite.
- One source of truth per (document, value). A second commit of an *edited* value updates in place
  only if the physician re-confirms (explicit), recorded as a new `physician-corrected` revision.

### Flow (the review modal IS the human-in-the-loop gate)
Upload → auto-extract (once) → cached draft → **review modal** (read-only display + the new controls)
→ physician Accepts/Edits/Discards → **Commit** → module validates (citation + ownership) → writes the
Observations → returns a per-value result (written / skipped-duplicate / rejected) → the modal reflects
it. The `interrupt`/resume framing in the rule maps here to the modal: nothing writes until Commit.

## Write mechanism — DECIDED (2026-07-14, codebase investigation)
**`OpenEMR\Services\ObservationService::saveObservation()` → the `form_observation` table**, read
back as a FHIR `Observation` (category `laboratory`) by `FhirObservationObservationFormService` at
`GET /fhir/Observation`. Chosen because it is the **only** OpenEMR path with a real, maintained
*create* method (the procedure-tables lab path has no service-level create — ~4 raw coordinated
inserts; FHIR `POST /Observation` does not exist, routes are GET-only). It is module-callable
in-session (`new ObservationService()`), first-class FHIR-visible (satisfies "persist as FHIR/OpenEMR
records"), and has built-in `ob_documentationof_table` + `ob_documentationof_table_id` columns → the
`derivedFrom` link to the source `documents` row for free.

**Insert recipe** (in the module endpoint, in the physician's session, AFTER the `PanelService`
ownership re-check on the bound pid):
```
$svc = new OpenEMR\Services\ObservationService();
$svc->saveObservation([
  'pid' => $ownedPid, 'encounter' => $encounterId, 'user' => $authUser, 'groupname' => $authProvider,
  'date' => <now>, 'code' => 'LOINC:'.$loinc /* or text-only v1 */, 'description' => $testName,
  'ob_value' => $value, 'ob_unit' => $unit, 'ob_status' => 'final',
  'ob_type' => $labTypeOptionId /* Observation_Types option → drives FHIR category=laboratory */,
  'category' => 'laboratory',
  'ob_documentationof_table' => 'documents', 'ob_documentationof_table_id' => $documentId,
]);
```

**Build-time facts to verify (from the investigation):**
- **Idempotency is the module's job** — `form_observation` has no unique key on doc/citation. Before
  insert, query existing rows by `ob_documentationof_table_id` + code + value (or a stored citation
  id); re-commit = no-op. This is the spec's idempotency guarantee, enforced in the writer.
- **Category round-trip:** confirm which `Observation_Types` `ob_type` option_id makes the row read
  back under `category=laboratory` (insert → `GET /fhir/Observation?category=laboratory&patient=…`).
- **`ob_status`:** confirm the form service's status list accepts `final` (else map).
- **Reference range:** `form_observation` has no low/high columns → carry the range in `description`
  (or drop) for v1; note the fidelity tradeoff vs the procedure path.
- **Encounter:** reuse an existing encounter for the pid, else `EncounterService::insertEncounter()`.
- **Ownership gate:** reuse `PanelService::ownedPatientFhirId($userId, $pid)` at the write boundary.

**Scope for v1:** `lab_pdf` values first. `intake_form` (meds/allergies/family history) is a
follow-on — different services, riskier.

## Boundaries (what 2f does NOT do)
- No new extraction (extract-once holds; this reads the committed draft).
- No sidecar write, no OAuth write scope, no automatic/upload-time write.
- No overwrite without explicit physician re-confirm.
- v1 does not write intake-form facts (meds/allergies) — lab values only.

## Acceptance criteria
- An Accepted, cited value → exactly one Observation, `derivedFrom` the DocumentReference, provenance
  = co-pilot-derived + hash + citation.
- Re-committing the same document/value → no second Observation (idempotent no-op).
- A Discarded or untouched value → nothing written.
- A value with no box-match citation cannot be committed until edited/confirmed → then written
  `physician-corrected`.
- An edited value → written `physician-corrected`; its citation no longer claims to match the page.
- A commit for a non-owned pid is refused (ownership re-checked at the module boundary).
- The write is auditable: the co-pilot disclosure/write log records who/what/when (independent of
  OpenEMR's `log`).

## Open questions
- **Write mechanism (A/B/C)** — the decision above. Recommend A if OpenEMR's lab-create path is
  tractable within budget; else B as a safe, fully-idempotent fallback that still satisfies the rule
  (derived Observation + provenance + no duplicates), documented as co-pilot-derived.
- LOINC coding: extract-time vs a lookup vs leave uncoded (`code.text` only) for v1 — likely uncoded
  text + unit for v1, coded as a follow-on.
- Revision model for a re-edited value (new Observation vs amend) — default: amend in place on
  explicit re-confirm, prior value retained in provenance.

## Build order (TDD increments, serial — safety core)
1. The **module write endpoint** contract (Zod/PHP: accepts `{documentHash, values:[{citationId,
   value, accepted, edited}]}`, ownership-checked) — reject/validate tests first.
2. The **idempotent Observation writer** (pure mapping draft-value → Observation + the find-by-key
   guard) with unit tests, behind whichever mechanism (A/B) we pick.
3. The **review UI controls** (accept/discard/edit + Commit) + the per-value result rendering.
4. End-to-end: upload → review → commit → Observation visible → re-commit is a no-op.
