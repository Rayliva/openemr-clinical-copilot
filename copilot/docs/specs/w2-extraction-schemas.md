# Spec — W2 extraction schemas + citation contract

> Feature spec for the Week 2 canonical extraction contracts. Grounded in
> `Week_2_AgentForge.pdf` Core Req 2 (structured schemas) + Req 5 (citation), the
> `w2-document-ingestion-writes` rule, and `../../W2_ARCHITECTURE.md §4`.
> Package: `@copilot/ingestion` (pure; no VLM/OCR/IO in this slice).

## Behavior

Provide strict **Zod** schemas that are the **canonical contract** for extracted
document facts. Raw VLM output is `parse`d against these at the boundary; anything that
doesn't conform is rejected (bounded-retry/degrade happens upstream, not here). No raw
VLM output may bypass these schemas (`w2-document-ingestion-writes`).

### 1. Citation (machine-readable, PDF Req 5)
`Citation` carries, for one extracted value, where it came from:
- `sourceType` — enum: `lab_pdf | intake_form | chart | guideline` (the kinds of
  evidence sources; documents + chart + RAG share the one shape).
- `sourceId` — string (the source document id / `DocumentReference` id / chart row uuid
  / guideline chunk id).
- `pageOrSection` — string (e.g. `"p2"` / `"Vitals"` / a guideline section).
- `fieldOrChunkId` — string (the field key or retrieved chunk id).
- `quoteOrValue` — string (the text the source shows — the VLM's `quote_or_value`,
  used to cross-check against OCR).
- `locator` — optional bounding box `{page:int>=1, x, y, w, h}` in [0,1]-normalized
  page coords; **absent when a tight box could not be located** (three-way outcome —
  the citation degrades to page/section, it is never dropped).
- `corrected` — optional boolean; `true` when the value was physician-edited (the box
  points to the region but the value no longer matches the page text).

*(camelCase in TS; a 1:1 snake_case wire form `{source_type, source_id, page_or_section,
field_or_chunk_id, quote_or_value}` is produced at the response boundary in a later
slice — matches the W1 session-token camelCase-internal/snake_case-wire split.)*

### 2. Lab PDF extraction (PDF Req 2)
`LabPdfExtraction`:
- `docType` — literal `"lab_pdf"`.
- `results` — array of `LabResult`, each:
  - `testName` — non-empty string.
  - `value` — **string** (preserve as-read: `"7.2"`, `"<5.7"`, `"Negative"` — never
    coerce to number; string avoids the `"123abc"→123` trap and keeps qualitative
    results).
  - `unit` — optional string.
  - `referenceRange` — optional string.
  - `collectionDate` — optional string (absence-aware — a scan may not show it).
  - `abnormalFlag` — enum `normal | high | low | critical | abnormal | unknown`.
  - `citation` — `Citation` (**required** — no fact without a citation).
  - `confidence` — number in `[0,1]` (per-field confidence; drives review attention).

### 3. Intake form extraction (PDF Req 2)
`IntakeFormExtraction`:
- `docType` — literal `"intake_form"`.
- `demographics` — object (all optional, absence-aware): `name?, dob?, sex?, phone?,
  address?`.
- `chiefConcern` — optional string.
- `currentMedications` — array of `{ name, dose?, citation, confidence }`.
- `allergies` — array of `{ substance, reaction?, citation, confidence }`.
- `familyHistory` — array of `{ condition, relation?, citation, confidence }`.
- `citation` — a document-level `Citation` for the form as a whole.
- Each list item carries its own `citation` + `confidence`.

## Boundaries (what this slice does NOT do)
- No VLM call, no OCR, no bounding-box computation (the `locator` is accepted if
  present, not produced here).
- No FHIR mapping, no writes, no persistence.
- No confidence *thresholding* / review logic — schemas only validate structure.

## Acceptance criteria
- A well-formed lab extraction object **parses**; the parsed type is fully typed.
- A lab result **missing `citation`** is **rejected**.
- A lab result **missing `confidence`**, or with `confidence` outside `[0,1]`, is
  **rejected**.
- An **invalid `abnormalFlag`** value is rejected; a valid one parses.
- `value` stays a **string** (`"<5.7"` survives round-trip unchanged).
- `collectionDate`/`unit`/`referenceRange` **absent** → parses with those undefined
  (absence-aware), not defaulted.
- A `Citation` missing any required field (`sourceType`/`sourceId`/`pageOrSection`/
  `fieldOrChunkId`/`quoteOrValue`) is rejected; `locator`/`corrected` optional.
- A `Citation.locator` with an out-of-range coord (page < 1, or x/y/w/h outside [0,1])
  is rejected.
- A well-formed intake extraction object parses; a medication/allergy/family-history
  item missing its `citation` or `confidence` is rejected.
- An **omitted `demographics`** block degrades to `{}` (absence-aware) rather than
  failing the whole-document parse.
- The schemas are **plain declarative Zod** (no `.transform`/`.refine`) so they are used
  **directly** as the VLM tool contract via the AI SDK's `generateObject` (which handles
  JSON-Schema conversion internally) — no hand-written schema.

## Open questions
- Whether `collectionDate` should be validated as an ISO date or kept as free string
  (leaning free string for slice 1 — the VLM returns as-read; normalization is a later
  concern). Recorded, not blocking.
- Exact FHIR representation of intake facts (Observation vs. other) — out of scope here
  (ingestion-persist slice).
- **Reconcile `Citation` with the W1 `Provenance` shape** (`packages/snapshot`
  `{sourceTable, rowUuid, fetchedAt}`). The citation-check slice will reuse `Citation`
  for chart + guideline claims; the `provenance-and-grounding` rule mandates `fetched_at`
  on every fact, which `Citation` does not yet carry. Decide there whether `Citation`
  gains a `fetchedAt`, or the two shapes bridge at the citation-check boundary.
- **Value/box tightening (nits, deferred):** empty `value` is intentionally *permitted*
  (a blank cell surfaces as low-confidence in review rather than hard-rejecting the whole
  doc); an on-page bounding-box refine (`x+w<=1`, `y+h<=1`) is deferred to the overlay
  slice that renders boxes.
