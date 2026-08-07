# Spec — W2 lab-ingestion pipeline (Slice 2d)

> Wire the pieces built in 2a–2c into one flow: a detected pending document → its bytes →
> rasters → a schema-valid extraction with OCR-located citations → a **pending-review draft**.
> Pure orchestration over injected ports (`orchestrator-only`); the concrete ports (FHIR Binary
> fetch, rasterize, VLM, OCR) are wired at the edge. Traces to Core Req 1. **No write** — the
> draft is proposed for human review; the module commit is Slice 2f (`w2-document-ingestion-writes`).

## Split
- **Pure, in `@copilot/ingestion` (`src/pipeline.ts`):** `ingestLabDocument(doc, deps)` — the flow,
  over injected ports. No IO of its own.
- **New port, in `@copilot/ingestion` (`src/rasterize.ts` / a fetch type):** `BinaryFetchPort =
  (binaryId: string) => Promise<Uint8Array>` — fetch a document's bytes by its `Binary/<id>`. The
  concrete impl (openemr-client `read("Binary", id)` → decode) is Slice 2d's edge, later wired.

## Behavior — `ingestLabDocument(doc: PendingDocument, deps): Promise<LabIngestionDraft>`
Deps (all injected): `{ fetchBinary: BinaryFetchPort, rasterize: PdfRasterizePort, vlm:
VlmExtractPort, ocr: OcrPort }`.

Flow:
1. `bytes = fetchBinary(doc.binaryId)` — the PDF bytes.
2. `pages = rasterize(bytes)` — page images (feeds both VLM and OCR).
3. `outcome = extractLabPdf(vlm, pages)` — schema-canonical extraction (raw VLM never bypasses the
   schema; bounded retry → degrade).
   - **degraded** → return `{ status: "degraded", documentId, pages, issues }` — no OCR/locate on an
     invalid extraction; the human reviews the flagged fields. (`pages` still returned for the overlay.)
4. **ok** → `ocrPage = ocr({ pages })`, then `located = locateLabResults(extraction, ocrPage)` — each
   value's citation gets a box when located; never a dropped citation.
   - return `{ status: "ok", documentId, pages, results }` (the located `LocatedLabResult[]`).

`LabIngestionDraft` is a discriminated union on `status` so an invalid extraction is unrepresentable
as "ok". `pages` are carried so the review UI (2e) can draw the box overlay without re-rasterizing.

**Errors:** `fetchBinary` / `rasterize` / `vlm-transport` / `ocr` failures **propagate** (typed,
PHI-free — the caller node logs + degrades). Only the *schema-degrade* is a draft status; infra
failures are the caller's concern (`error-handling-and-logging`: catch where recovery is meaningful,
which is the node, not this pure flow).

## Boundaries (Slice 2d does NOT do)
- **No persistence / no chart write** — the draft is proposed; commit is 2f.
- **No review UI** — 2e renders the draft + overlay.
- **No intake_form path** — lab_pdf first (the demo anchor); intake reuses the same shape next.
- **No doc-type classification** — the caller supplies a lab document (from the DocumentReference
  category); a VLM/category classifier is a later concern.
- **No graph wiring** — the intake-extractor worker node (apps/agent) calls this in a later step.

## Acceptance criteria
- Given stub ports returning the committed fixture (PDF bytes → committed PNG page → committed
  extraction as canned VLM output → committed OCR map), `ingestLabDocument` returns `status: "ok"`
  with the 8 lab results, the A1c value `located` with a box, and the page image(s) carried.
- A VLM stub that returns schema-invalid output → `status: "degraded"` with `issues`, no results, pages carried.
- An OCR that yields no words (empty page) still returns `status: "ok"` — every result present, all
  `unverified` (forced review), **no dropped citation**.
- `fetchBinary` / `rasterize` rejection propagates (not swallowed).
- Pure: deterministic given deterministic ports; no IO.

## Open questions
- **doc-type classification** — lab vs intake from the DocumentReference category vs a VLM classify step.
- **infra-failure → draft vs propagate** — v1 propagates infra errors to the node; a "could not ingest"
  draft state is a possible refinement if the review UI wants to show failed ingestions.
