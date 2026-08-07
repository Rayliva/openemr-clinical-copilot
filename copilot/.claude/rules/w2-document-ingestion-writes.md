# Document ingestion & the write path (W2)

Week 2 adds the **only** write in the system: persisting an ingested document's derived
facts. It is constrained so a hallucinated value can never silently become chart data.
Grounded in `../../W2_ARCHITECTURE.md §4` and `docs/w2-PRD.md` feature #3.

## The rules
- **The schema is the canonical contract.** Raw VLM output **never** bypasses its Zod
  schema (`lab_pdf` / `intake_form`). Malformed → bounded retry → degrade with the
  field flagged; never a silent pass or drop.
- **The sidecar never writes to the chart.** It extracts and *proposes*; the **OpenEMR
  module commits**. No OAuth **write** scope is requested (read-only client holds).
- **No derived fact commits without physician confirm.** The graph pauses
  (`interrupt`); the physician reviews values + boxes + confidence and confirms. The
  human is the authority for the write path.
- **No fact commits without a citation.** Box-match is three-way: tight box /
  page-level "approximate" / "not found on page → forced review." Never a silent fill.
- **A physician-edited value is recorded `physician-corrected`** in its citation — the
  value no longer matches the page text, so the citation must say so.
- **Writes are idempotent + traceable.** Derived `Observation`s link `derivedFrom` the
  source `DocumentReference`, keyed by document content hash — no duplicate, no
  untraceable record. One source of truth per type; **no silent overwrite**.
- **Extract once.** The VLM runs at upload, not per question; later turns read the
  committed FHIR.

## Why
A wrong lab value written to the chart is worse than one shown in chat. Determinism
(schema) shapes the data; the human gates its truth; provenance keeps every write
auditable and reversible.

## Do / Don't
- **Do:** `parse(lab_pdf, vlmOutput)` → review → module write on confirm.
- **Don't:** write `vlmOutput` straight to FHIR, or auto-commit on upload.
- **Do:** re-ingest the same PDF → no-op (hash match).
- **Don't:** create a second Observation for the same source value.
