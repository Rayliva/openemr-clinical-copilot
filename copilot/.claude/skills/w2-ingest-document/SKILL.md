---
name: w2-ingest-document
description: Ingest a clinical document (lab PDF or intake form) — VLM extraction against a strict Zod schema, OCR bounding-box location, human-in-the-loop review, and idempotent write of derived FHIR records through the OpenEMR module. Use for any Week 2 document-ingestion work — attach_and_extract, the lab_pdf/intake_form schemas, the extraction→review→commit flow, the citation/bounding-box overlay, or the pending-review detection.
---

# Skill: w2-ingest-document

## When to use
Any Week 2 document-ingestion work: the `attach_and_extract` tool, the `lab_pdf` /
`intake_form` schemas, VLM extraction, OCR box location, the review surface, or the
module write of derived FHIR records. This is the one new **write** path in Week 2.
See `W2_ARCHITECTURE.md` §4.

## The invariants (do not violate)
- **Extract once, then read as chart data.** The VLM runs **once at upload**, never
  per question. Derived facts become ordinary FHIR `Observation`s read back through
  the normal path (`openemr-fhir-read`).
- **The schema is the canonical contract.** Raw VLM output can **never** bypass the
  Zod schema (`typescript-standards`, PDF eng req). Malformed → bounded retry →
  degrade with the field flagged, never a silent drop.
- **The sidecar never writes.** The sidecar extracts and *proposes*; the **OpenEMR
  PHP module commits** (system of record keeps its audit). No new OAuth **write**
  scope — the write is module-internal (`register-oauth-client` stays read-only).
- **No fact commits without a citation, and never without physician confirm.**

## Steps
1. **Spec first** (`spec-driven-development.md`) at `docs/specs/w2-<feature>.md`:
   behavior, boundaries, acceptance criteria, failure modes.
2. **Zod schemas** (`packages/ingestion/src/schemas/`), the canonical contracts:
   - `lab_pdf`: ≥ test name, value, unit, reference range, collection date,
     abnormal flag, **source citation** — plus per-field **confidence**.
   - `intake_form`: demographics, chief concern, current meds, allergies, family
     history, **source citation**.
   - Citation shape (machine-readable, all sources):
     `{source_type, source_id, page_or_section, field_or_chunk_id, quote_or_value}`.
   - TDD the validators first (guard: VLM emits an out-of-contract / wrong-typed field).
3. **Extraction (pure, `packages/ingestion`):**
   - **Claude VLM** reads the page image(s) → proposes fields **and** a
     `quote_or_value` per field. Call through the **model-role abstraction** (VLM
     role), never a hardcoded model.
   - Validate against the Zod schema at the boundary (parse, don't validate downstream).
   - **Tesseract OCR** — **in-process `tesseract.js` (WASM), in-boundary** (not a service
     container; decision `docs/decisions/w2-ocr-engine.md`) → page **word→coordinate map**.
     Committed fixture maps for offline CI; live in-process OCR on a front-desk upload.
4. **Box-match = hallucination cross-check (three-way — never a silent fill):**
   - value + **tight box** → normal confidence.
   - value + **no tight box, text on page** → cite **page/section**, flag "location
     approximate."
   - value + **text not in OCR at all** → flag "couldn't verify against page text,"
     **force to top of review**.
   - Box-match confidence feeds the per-field confidence the physician sees.
5. **Hold as a pending-review draft** in the **agent Postgres** (not the chart —
   nothing is written pre-confirm). Detection is lazy on chart-open: list the
   patient's `DocumentReference`s via FHIR (`openemr-fhir-read`), diff against the
   already-committed set (by document hash).
6. **Human-in-the-loop review + write approval:**
   - Widget launcher shows a **notification badge** (count of un-reviewed docs for
     the bound pid).
   - The **module-hosted review surface** (roomy modal, not the chat column): left =
     page screenshot with boxes; right = one row per field (name · value · confidence),
     row↔box linked; accept (✓) / edit per field; **"accept all remaining"** for the
     high-confidence set.
   - A **physician-edited** value is recorded `physician-corrected` in its citation
     (the box points to the region; the value no longer matches the page text).
   - **Decoupled, no interrupt (v1):** extraction produces the draft and **ends**; the
     physician reviews + confirms **out-of-band** in the module surface; confirm
     triggers the write. Do **not** pause a chat turn / use LangGraph `interrupt` in v1
     (avoids durable cross-service resume infra).
7. **Persist (module write) + FHIR integrity:** on confirm the **module** writes
   derived `Observation`s linked **`derivedFrom`** the source `DocumentReference`,
   **idempotent by document content hash** — same bytes = no-op; a different document =
   new record; VLM non-determinism on identical bytes is suppressed (not re-extracted).
   One source of truth per type; no silent overwrite.
8. **Wire into the graph** as the **intake-extractor worker** (the PDF's required name;
   handles `lab_pdf` + `intake_form`) — a thin node over `packages/ingestion` that
   extracts → produces a reviewable draft; it does **not** write or block the turn
   (`w2-supervisor-workers`, `orchestrator-only`).
9. **Eval + tests:** extraction regression cases (`add-eval-case`, `week:2`);
   integration test over ingest→review→commit with **fixture docs + stubbed VLM/OCR**
   (`w2-eval-ci-gate`).

## Common pitfalls
- **Never let raw VLM output through unvalidated** — the schema is the gate.
- **Never auto-commit** — the physician is the authority for the write path.
- **Never drop a citation** — degrade to page/section, or flag as unverified.
- **Don't re-VLM on every question** — extract once, then read the committed FHIR.
- **Don't write from the sidecar** or request an OAuth write scope — writes go
  through the module.
- **Keep OCR + document images in-boundary** — in-process `tesseract.js` (self-hosted in
  the agent); never ship a document image to a hosted OCR service (`phi-and-secrets`, PDF
  pitfall).
