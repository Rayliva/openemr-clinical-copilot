# Spec — Referral-fax ingestion (W2 #6, a fourth document type)

Status: in progress · Traces to: PDF Core Deliverables "a third document type such as
**referral fax** or medication list", UC-2. Compounds the existing ingestion machinery
exactly like `w2-medication-list-ingestion.md` did.

## Problem

The delivered third document type is `medication_list`; the PDF's example naming a **referral
fax** is unimplemented. A referral fax is the messy real-world input a front desk uploads before
a specialist follow-up — precisely the Week 2 scenario. Add `referral_fax` as a first-class doc
type end-to-end, reusing the shared pipeline / review UI / write path unchanged.

## Behavior

A detected document classified `referral_fax` ingests through the same
fetch → rasterize → VLM-extract (schema-canonical) → OCR box-match → pending-review-draft path
as the other three types, producing the same `LabIngestionDraft` (so the review overlay + commit
path are unchanged). Extracted fields (each cited + confidence-scored, absence-aware):

- `referralDate` — the date on the fax
- `referringProvider` — who is referring
- `referredTo` — the specialty/provider being referred to
- `reason` — reason for referral
- `diagnosis` — the working diagnosis / relevant problem

Each present field flattens to one labeled review value (`Referral date`, `Referring provider`,
`Referred to`, `Reason for referral`, `Diagnosis`), box-matched against the page. A value with no
located box is **forced to review**, never dropped. An absent field is omitted (absence ≠ empty
row). Raw VLM output never bypasses the `ReferralFaxExtraction` Zod schema (bounded retry → typed
`degraded`).

Classification: a title/filename naming a referral / consult request → `referral_fax`, checked
before the intake heuristic (a "Referral Form" also contains "form"). Space **or** hyphen
separators (a filename like `underwood-susan-referral-fax.pdf` classifies too).

## Boundaries

- No new pipeline, review surface, cache, or write path — reuse all (`orchestrator-only`,
  `w2-document-ingestion-writes`). Only a new schema + box-match + classify branch + dispatch case.
- The sidecar still never writes; the module commits on physician confirm (unchanged).
- Each referral field carries **its own** VLM citation + confidence (unlike intake demographics,
  which synthesize one) — a referral value is a real extracted fact, so its provenance is per-field.
- Unique labels per field → no write-path key collision (each label distinct; no numbering needed).

## Acceptance criteria

1. `ReferralFaxExtraction` Zod schema (`docType: "referral_fax"`, five optional cited fields, a
   document citation) with validation tests; raw VLM output is `safeParse`d against it.
2. `classifyDocType` returns `referral_fax` for referral/consult titles (space or hyphen), and does
   NOT reclassify the existing med-list / intake / lab titles (regression-guarded).
3. `locateReferralFaxValues` flattens present fields to `LocatedLabResult[]`, box-matches each,
   forces unlocated values to review, omits absent fields.
4. `ingestReferralFaxDocument` mirrors the other pipelines (degrade on schema failure / zero pages;
   OCR-empty → all forced review; infra errors propagate).
5. `ingestByType` handles `referral_fax` (exhaustive switch — compile error until added), and the
   VLM adapter has a `referral_fax` schema + field-list entry.
6. `CitationSourceType` enum gains `referral_fax`.
7. Offline unit tests: schema, classify (both separators + negatives), box-match (located +
   forced-review + absent-omit), pipeline (ok / degrade / empty-OCR). No live keys.
8. A committed demo document (`demo-documents/*-referral-fax.{html,pdf}`).

## Open questions

None — this is an additive mirror of the medication-list slice.
