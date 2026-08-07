# Decision — W2 PDF→raster engine (uploaded Binary → page image)

> **Status:** accepted · **Date:** 2026-07-14 · **Weight:** light (a deterministic image
> conversion, not safety-critical — it cannot invent clinical data; a bad render just degrades
> the VLM/OCR to "can't read it"). No plan-reviewer round (unlike the OCR-engine decision, this
> does **not** deviate from any locked arch choice — runtime rasterization was simply unspecified).
> **Scope:** how the live front-desk-upload path turns an uploaded **PDF `Binary`** into the page
> **raster** that both the VLM (`createClaudeVlm`) and the in-process OCR (`createTesseractOcr`)
> consume. Fixtures already ship committed PNGs; this is only for a real, un-fixtured upload.

## Decision
Rasterize PDF pages **in-process** with **`pdfjs-dist`** (Mozilla PDF.js, Apache-2.0) rendering
onto **`@napi-rs/canvas`** (MIT, prebuilt native binaries — no node-gyp build), behind an injected
`PdfRasterizePort`. One rasterization per upload feeds both the VLM and the OCR. Consistent with the
OCR decision: in-process, no new container, no system package, PHI stays in the process.

**Spiked + proven (2026-07-14):** the committed `susan-lab-panel.pdf` → page-1 PNG (1224×1584) →
the `createTesseractOcr` adapter → `locateLabResults` **located all 8 lab values**. End-to-end works
on the real fixture PDF.

## Options
- **`pdfjs-dist` + `@napi-rs/canvas` (CHOSEN):** pure-JS PDF parser + prebuilt native canvas. No
  build step, cross-platform prebuilds (Windows dev + linux Docker), permissive licenses, in-process.
- **`mupdf` (npm, WASM):** clean render API, no native dep — **rejected: AGPL-3.0** (or paid
  commercial). AGPL is a non-starter for this product; recorded so a future agent doesn't "simplify"
  to it.
- **`poppler` / `pdftoppm` (CLI):** fast, battle-tested — rejected: a **system package** (or a new
  container), against the in-process/no-new-infra posture the OCR decision set.
- **Cloud PDF render (e.g. a SaaS):** rejected outright — sends the PHI document to a non-BAA service
  (`phi-and-secrets`, in-boundary-by-default).
- **VLM reads the PDF directly (skip rasterization):** Claude can accept a PDF, but **OCR box-match
  and the click-to-source overlay both need a page raster** regardless — so rasterization is
  unavoidable, not an optimization we can drop.

## Consequences
- `PdfRasterizePort` (type) lives in `@copilot/ingestion` beside `OcrPort`/`VlmExtractPort`; the
  concrete `createPdfRasterizer` (pdfjs + canvas) lives at the edge in `apps/agent`
  (`orchestrator-only`). Both deps are runtime deps of `apps/agent` only.
- **PHI-safe errors** (`PdfRasterizeError`) — the PDF bytes are PHI; a render failure re-throws a
  message-only error, no bytes, no chained `cause` (mirrors `OcrTransportError`).
- **Bounded:** a `maxPages` cap (default 20) so a pathological upload can't exhaust memory; exceeding
  it fails fast. A lab/intake doc is 1–2 pages.
- Arch doc §4.2 gets a one-line note that runtime rasterization is pdfjs+canvas in-process.

## Open questions
- **Render scale:** `scale: 2` (≈150 DPI) matched the committed golden's fidelity and OCR'd cleanly.
  Higher scale = sharper OCR but larger images to the VLM; revisit if a real upload OCRs poorly.
- **Non-PDF uploads** (e.g. a photographed intake form as JPEG/PNG): those are already page images —
  a later slice can pass them straight through, skipping rasterization.
