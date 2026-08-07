# Spec — medication-list ingestion (third document type, W2)

Status: implemented (code + tests green; not yet deployed). Adds a **third** document type,
`medication_list` (a pharmacy printout / medication-reconciliation list), to the Week 2 ingestion
flow — the "third document type such as referral fax or medication list" stretch deliverable. It
compounds the existing machinery rather than forking it (`week-scoping-convention`): same VLM
extract engine, same `LocatedLabResult[]` draft shape, same review UI + write path.

## Why medication list (over referral fax)
It is the lowest-risk, highest-value third type: structurally a subset of the intake form (a list
of medications), so it reuses the numbered-field flatten that already prevents the write-path key
collision, and it strengthens the med-reconciliation story (UC-3) — a pharmacy list is a second
medication source to reconcile against `lists` + `prescriptions`.

## Behavior
- **Classification** (`classifyDocType`): a title naming a medication list / pharmacy printout / med
  reconciliation → `medication_list`. Checked **before** the intake heuristic (so "Medication
  Reconciliation Form" routes to `medication_list`, not `intake_form`, despite containing "form").
  Separators are space **or** hyphen so a filename (`…-medication-list.pdf`) classifies too.
- **Schema** (`MedicationListExtraction`): `{ docType: "medication_list", medications: [{ name,
  dose?, frequency?, status?, citation, confidence }], citation }`. Raw VLM output never bypasses it
  (bounded retry → typed `degraded`). `CitationSourceType` gains `medication_list`.
- **Extraction** (`extractMedicationList`) + **VLM prompt**: the field list instructs the model to
  extract each medication's name/dose/frequency/status exactly as printed, with its own citation +
  confidence. `selectExtractionSchema` + `FIELD_LIST` are exhaustive over `DocType`.
- **Box-match** (`locateMedicationListValues`): flattens each medication into a numbered
  `Medication N` `LocatedLabResult` (stable position → unique key → no supersede/void collision on
  commit). Display `value` carries the printed status ("Metformin 1000 mg daily (active)"); the
  box-match `matchText` is the status-free drug text (the status word may not sit by the drug on the
  page). An unlocated value is forced to review, never dropped.
- **Pipeline** (`ingestMedicationListDocument`): mirrors `ingestIntakeDocument` — fetch → rasterize →
  extract (degrade on schema failure / zero pages) → OCR box-match. Infra failures propagate.
- **Routing** (`ingestByType` in the agent ingestion service): exhaustive `switch` over `DocType`
  (no `default`), so a fourth type is a compile error until handled.
- **Review + write**: unchanged. The draft is the same shape, so the review overlay, the commit
  endpoint, and the `form_observation` write path all work as-is; each numbered medication commits
  as its own derived observation, `derivedFrom` the source document, idempotent.

## Boundaries
- Read-only sidecar; the module still commits (no new write path).
- No new OAuth scope — reuses the existing `DocumentReference.read` + `Binary.read`.
- Extraction is schema-canonical; a hallucinated med can never bypass the schema or the physician
  review + confirm gate (`w2-document-ingestion-writes`).

## Acceptance criteria
- **AC1** A "Medication List" / "Pharmacy Printout" / `*-medication-list.pdf` title classifies as
  `medication_list`; "Medication Reconciliation Form" does too (med-list beats intake).
- **AC2** A valid extraction parses; a wrong `docType` fails (schema canonical).
- **AC3** N medications flatten to `Medication 1..N` (unique keys); an unlocated med is forced to
  review, never dropped; the display value includes the printed status.
- **AC4** The pipeline degrades on schema failure / zero pages, forces review on empty OCR, and
  propagates infra failures — offline-testable with stub deps (no live VLM/OCR/network).

## Tests
- `packages/ingestion/test/classify.test.ts` (AC1), `medicationList.test.ts` (AC2, AC3),
  `medicationListPipeline.test.ts` (AC4). Demo uploads: `demo-documents/*-medication-list.{html,pdf}`.
