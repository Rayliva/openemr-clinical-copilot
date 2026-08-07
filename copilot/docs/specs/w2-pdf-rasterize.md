# Spec — W2 PDF→raster adapter (Slice 2b)

> Turns an uploaded PDF `Binary` into the page rasters the VLM + OCR consume. Engine decision:
> `docs/decisions/w2-pdf-rasterizer.md` (in-process `pdfjs-dist` + `@napi-rs/canvas`). Traces to
> Core Req 1 (ingestion). Feeds `createClaudeVlm` and `createTesseractOcr`, which both take
> `PageImage[]` — so one rasterization serves both.

## Split (orchestrator-only)
- **Contract, in `@copilot/ingestion` (`src/rasterize.ts`):** the `PdfRasterizePort` type — no
  engine import.
- **Edge, in `apps/agent` (`src/pdf/pdfRasterize.ts`):** `createPdfRasterizer` — the concrete
  pdfjs + canvas render, behind an injected `RenderPdfPages` seam so the orchestration is
  offline-testable.

## Behavior

### Contract — `PdfRasterizePort`
`(pdf: Uint8Array) => Promise<readonly PageImage[]>` — decode a PDF's bytes into one `PageImage`
per page (1-based `page`, `mediaType: "image/png"`, base64 PNG), in page order.

### Edge — `createPdfRasterizer(options?): PdfRasterizePort`
- Injected seam `RenderPdfPages = (pdf: Uint8Array, scale: number) => Promise<readonly Buffer[]>`
  (one PNG buffer per page). Default uses `pdfjs-dist` (legacy build) + `@napi-rs/canvas` at
  `scale` (default 2 ≈150 DPI, which OCR'd the fixtures cleanly).
- Maps the rendered buffers → `PageImage[]` with 1-based page numbers and base64 PNG.
- **`maxPages` cap** (default 20): a document with more pages fails fast (`PdfRasterizeError`) — a
  pathological upload can't exhaust memory.
- **PHI-safe:** a render failure re-throws a message-only `PdfRasterizeError` (no PDF/image bytes,
  no chained `cause`), mirroring `OcrTransportError`.
- **Empty result** (a PDF that renders zero pages) → `PdfRasterizeError` (never a silent empty set
  that would degrade extraction to nothing).

## Boundaries (Slice 2b does NOT do)
- **No upload/download, no detection, no VLM/OCR call, no persistence** — later slices. This only
  produces page images from PDF bytes.
- **No non-PDF passthrough** (photographed forms) — a documented later slice.
- **No wiring into the graph** — proven now by a live-verify (rasterize the fixture PDF → OCR →
  values locate), integrated into the pipeline in Slice 2d.

## Acceptance criteria
- `createPdfRasterizer` over an injected `RenderPdfPages` returns one `PageImage` per rendered
  buffer, page numbers 1..N in order, `mediaType "image/png"`, base64 matching the buffer.
- A `maxPages`-exceeding document and a zero-page result each throw `PdfRasterizeError`.
- A seam failure re-throws a **PHI-free** `PdfRasterizeError` (no bytes, no `cause`).
- **Live-verify (author, not CI):** the real adapter rasterizes the committed `susan-lab-panel.pdf`
  → the OCR adapter → `locateLabResults` locates the lab values. *(Spiked 2026-07-14: 8/8 located.)*
- `apps/agent` typechecks; `@copilot/ingestion` stays engine-free.

## Open questions
- **Scale tuning** — `scale: 2` proven on the fixtures; revisit if a real scanned upload OCRs poorly.
- **Worker/init reuse** — pdfjs `getDocument` per call is fine at upload volume; revisit if Slice 2d
  shows it matters.
