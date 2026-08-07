# Spec — W2 intake-form ingestion pipeline

> The **second** document type. An uploaded intake form (PDF) → bytes → rasters → a schema-valid
> `intake_form` extraction with OCR-located citations → a **pending-review draft of the SAME shape
> the lab pipeline produces** (`LabIngestionDraft` with `results: LocatedLabResult[]`), so the
> existing review UI + service render it unchanged. Reuses the extraction engine (`extractDocument`)
> and the box-match core (`locateValue`) — it does **not** reimplement or change the lab path.
> Traces to Core Req 1/5; **no write** (`w2-document-ingestion-writes`). Grounded in
> `w2-ingestion-pipeline.md` (mirror), `../../W2_ARCHITECTURE.md §4`.

## Split (all pure, in `@copilot/ingestion`)
- **`extractIntakeForm(vlm, pages)`** (`src/extract.ts`, already present) — mirrors `extractLabPdf`
  over the `IntakeFormExtraction` schema. Same `ExtractionOutcome`.
- **`locateIntakeValues(extraction, ocrPage)`** (`src/intakeBoxMatch.ts`) — FLATTEN the intake
  extraction into labeled located values, each mapped to a `LocatedLabResult`, box-matched via the
  same `locateValue` helper `locateLabResults` uses.
- **`ingestIntakeDocument(doc, deps)`** (`src/pipeline.ts`) — mirrors `ingestLabDocument`; same
  `LabIngestionDeps`, same `LabIngestionDraft` return.
- **`classifyDocType(doc)`** (`src/classify.ts`) — a title heuristic choosing the doc type.

## Behavior

### `locateIntakeValues(extraction: IntakeFormExtraction, ocr: OcrPage): { results: LocatedLabResult[] }`
Flatten, in this order, into `LocatedLabResult` (the lab shape, reused verbatim):
- **demographics** — for each present field: `name→'Name'`, `dob→'DOB'`, `sex→'Sex'`,
  `phone→'Phone'`, `address→'Address'`. `value` = the field string; `unit` absent; `abnormalFlag`
  `'unknown'`; `confidence` 1 (a direct header field, no per-field model confidence); a **synthesized**
  citation (`sourceType:'intake_form'`, `sourceId` from the extraction's document citation,
  `pageOrSection:'Demographics'`, `fieldOrChunkId:'demographics-<field>'`, `quoteOrValue:value`).
- **currentMedications** — `testName:'Medication'`, `value` = `name` + (dose ? ` ${dose}` : ''),
  reuse the medication's citation + confidence.
- **allergies** — `testName:'Allergy'`, `value` = `substance` + (reaction ? ` — ${reaction}` : ''),
  reuse the allergy's citation + confidence.
- **familyHistory** — `testName:'Family history'`, `value` = (relation ? `${relation} — ` : '') +
  `condition`, reuse the entry's citation + confidence.

Each flattened value is box-matched with `locateValue(value, ocr)`: on `located` the box is written to
`citation.locator`; `approximate`/`unverified` keep the page/section citation (**never dropped**,
`w2-document-ingestion-writes`). Each result carries `match: { state, boxConfidence }` exactly like
`locateLabResults`. A value not found on the page → `match.state:'unverified'` (forced review), **not
dropped**.

### `ingestIntakeDocument(doc: PendingDocument, deps: LabIngestionDeps): Promise<LabIngestionDraft>`
Same flow as `ingestLabDocument`: `fetchBinary → rasterize → extractIntakeForm →`
(zero pages → `degraded`; schema-degrade → `degraded`, no OCR) `→ locateIntakeValues → { status:'ok',
results }`. Same discriminated `LabIngestionDraft`; `pages` carried for the overlay. Infra failures
(fetch / rasterize / VLM transport / OCR) propagate.

### `classifyDocType(doc: PendingDocument): "lab_pdf" | "intake_form"`
Pure title heuristic: `/intake|registration|new[- ]?patient|\bform\b/i` on `doc.title` →
`intake_form`; else `lab_pdf`.

## Boundaries (does NOT do)
- **No change to the lab path** — `ingestLabDocument` / `locateLabResults` / `extractLabPdf` untouched.
- **No persistence / chart write** — draft is proposed; commit is the module's job.
- **No new draft type** — reuses `LabIngestionDraft` so the review UI/service render unchanged.
- **No graph wiring** — the intake-extractor worker node (apps/agent) calls these later.

## Acceptance criteria
- Stub ports returning the committed `susan-intake-form` fixtures → `ingestIntakeDocument` returns
  `status:'ok'` with the flattened intake values (3 medications, 1 allergy, 5 demographics,
  2 family-history present), medication/demographic values `located` with a box, page carried.
- `locateIntakeValues`: a value present in OCR → `located` with a box; a value absent → `unverified`,
  no locator, citation preserved.
- Schema-invalid VLM output → `status:'degraded'`, `issues`, no results, OCR not run, pages carried.
- Zero-page rasterize → `degraded`. Empty OCR → `ok`, all `unverified`, no dropped citation.
- `fetchBinary` / `rasterize` rejection propagates.
- `classifyDocType`: an intake/registration/new-patient/"…form" title → `intake_form`; a lab title →
  `lab_pdf`.

## Open questions
- doc-type classification is a title heuristic in v1; a VLM/category classifier is a later refinement.
