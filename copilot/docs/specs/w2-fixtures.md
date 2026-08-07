# Spec — W2 synthetic document fixtures

> Feature spec for the shared Week 2 document fixtures. Grounded in the PDF scenario
> (a follow-up visit with recent info buried in a scanned lab PDF + intake form), the
> `w2-build-loop` P0 prerequisite, and `../../W2_ARCHITECTURE.md §16` (integration tests
> use fixture documents + stubbed VLM). Synthetic data only (`phi-and-secrets`).

## Why (what depends on these)
- The **50-case eval golden set** needs known documents with known expected extractions.
- The **offline integration tests** ("pass in CI without live API") stub the VLM with a
  fixture's **ground-truth extraction** and assert the downstream pipeline.
- The fixtures must be **reproducible from the repo alone** (committed).

## Anchor patient
**Susan Underwood (pid 2)** — the established W1 eval ground truth and a diabetes patient
for whom a follow-up lab panel + intake form is clinically natural. The documents are the
"recent info" for her follow-up visit.

## Behavior / contents
Two **paired** fixtures (source document + ground-truth extraction), under
`packages/ingestion/fixtures/w2/`:

1. **Lab panel** — `susan-lab-panel.html` (renderable source; a diabetes follow-up
   panel) + `susan-lab-panel.extraction.json` (a `LabPdfExtraction`). Panel includes at
   least: Hemoglobin A1c (high), fasting glucose (high), LDL (high), HDL (low),
   triglycerides (high), eGFR (low), creatinine (high) — realistic abnormal flags plus a
   mild renal signal relevant to diabetes.
2. **Intake form** — `susan-intake-form.html` + `susan-intake-form.extraction.json` (an
   `IntakeFormExtraction`) with demographics, chief concern, current medications
   (Metformin, Lisinopril, Atorvastatin), an allergy (Penicillin — a constraint-engine
   hook), and family history.

Each extracted value carries a `Citation` (`sourceType` = `lab_pdf`/`intake_form`,
`sourceId` = the fixture doc id, `pageOrSection`, `fieldOrChunkId`, `quoteOrValue`) and a
`confidence`. Bounding-box `locator`s are **omitted** at this stage (page/section-level
citation) — real OCR-located boxes are produced by the extraction+overlay slices; the
ground truth represents the schema-valid extraction, not the pixel layout.

## Boundaries (what this slice does NOT do)
- No PDF/PNG rendering of the HTML (the real VLM/OCR input + demo image is a later slice;
  the HTML is the human-readable, render-later source).
- No VLM call, no OCR, no persistence, no eval cases yet (those consume these fixtures).

## Acceptance criteria
- `susan-lab-panel.extraction.json` **parses** against `LabPdfExtraction`.
- `susan-intake-form.extraction.json` **parses** against `IntakeFormExtraction`.
- The lab ground truth contains the A1c-high result and at least one `low` and one
  `critical`-or-`high` flag (exercises the flag enum breadth).
- The intake ground truth contains the Penicillin allergy and ≥ 2 medications.
- The fixtures + their expected extractions live in-repo (reproducible).
- A validity test fails if a fixture drifts out of schema (guards fixture rot as the
  schemas evolve).

## Open questions
- HTML → PDF/PNG rendering approach for the real VLM input + demo (headless browser vs.
  a committed rendered asset) — decide in the VLM-extract / overlay slice.
- Whether the intake demographics must exactly match Susan's chart values (for a
  reconciliation eval) — currently the form is treated as independent source data.
