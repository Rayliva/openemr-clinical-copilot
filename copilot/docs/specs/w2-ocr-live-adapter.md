# Spec — W2 live OCR adapter (Slice 2a)

> The runtime half of the OCR decision (`docs/decisions/w2-ocr-engine.md`): an in-process
> `tesseract.js` adapter behind the `OcrPort` (spec `docs/specs/w2-ocr-port-and-maps.md`) that
> OCRs an uploaded page raster on the **live front-desk-upload path**. The offline half
> (committed golden maps) already covers CI; this covers a real, un-fixtured upload. Traces to
> Core Req 1 (ingestion) and Core Req 5 (bounding-box overlay).

## Split (orchestrator-only / pure-package rule)
- **Pure, in `@copilot/ingestion` (`src/ocrNormalize.ts`):** `normalizeOcrWords` — turn an OCR
  engine's raw word list (text + **pixel** bbox) + the raster dimensions + a page number into
  `OcrWord[]` with [0,1]-normalized boxes. Engine-agnostic (no `tesseract.js` import), unit-tested.
- **Edge, in `apps/agent` (`src/ocr/tesseractOcr.ts`):** `createTesseractOcr(): OcrPort` — the
  concrete `tesseract.js` call. Decodes each `PageImage`, reads its raster dimensions, recognizes
  words, calls the pure `normalizeOcrWords`, and merges pages into one `OcrPage`.

## Behavior

### Pure — `normalizeOcrWords(words, imageWidth, imageHeight, page): OcrWord[]`
- `words: RawOcrWord[]` where `RawOcrWord = { text, bbox:{x0,y0,x1,y1} }` (pixels).
- Each output box: `x=x0/W`, `y=y0/H`, `w=(x1-x0)/W`, `h=(y1-y0)/H`, each **clamped to [0,1]**
  and rounded to 5 decimals (identical to the committed-map generator, so the live path and the
  golden agree). `page` (1-based) is stamped on every box.
- **Drop** words whose trimmed `text` is empty (no matchable text) — never emit an empty-text word
  (matches the committed golden's integrity guarantee).
- **Throws** on a non-positive `imageWidth`/`imageHeight` or `page < 1` (fail-fast on a bad raster
  — never emit boxes normalized against a zero dimension).

### Edge — `createTesseractOcr(deps?): OcrPort`
- Returns an `OcrPort`: `(req) => Promise<OcrPage>`. For each `PageImage` in `req.pages`: decode
  the base64, read pixel dimensions (PNG IHDR), run `tesseract.js` `recognize`, flatten the
  block→paragraph→line→word tree, call `normalizeOcrWords(..., pageImage.page)`, and concatenate.
- **Pinned engine** (`tesseract.js@7`, `eng` LSTM) — the same engine as the committed golden, so a
  live OCR of a fixture raster matches the committed map. `tesseract.js` is a **runtime dependency
  of `apps/agent` only** (never `packages/*`).
- **PHI-safe errors:** the page image is PHI. A transport/recognition failure re-throws as a
  **PHI-free `OcrTransportError`** (message + optional code only; the original — which may hold
  image bytes — is not chained), mirroring `VlmTransportError`.
- **Bounded:** a per-call timeout; the worker is terminated on completion/failure (no leak). OCR is
  low-volume (once per upload), off the chat hot path.

## Boundaries (Slice 2a does NOT do)
- **No PDF→raster** — the adapter takes page images; rasterizing an uploaded PDF Binary is Slice 2b.
- **No upload detection, no review UI, no persistence** — later slices.
- **No wiring into the graph/upload path yet** — this is the reusable adapter; it is invoked by the
  ingestion pipeline in Slice 2d. It is proven now by a **live-verify against the fixture PNG**.

## Acceptance criteria
- `normalizeOcrWords` maps a pixel bbox to the correct [0,1] box (rounded), stamps the page, drops
  empty-text words, clamps out-of-raster pixels, and throws on a non-positive dimension or `page<1`.
- A live OCR of the committed `susan-lab-panel.page-1.png` via `createTesseractOcr` returns an
  `OcrPage` whose words validate (all boxes [0,1], single page) and which — fed to
  `locateLabResults` with the committed lab extraction — **locates the A1c value** (and ideally all
  8, matching the committed golden). *(Live-verified by the author, not a CI test — CI stays offline
  on the committed map.)*
- `apps/agent` typechecks; `@copilot/ingestion` stays pure (no `tesseract.js`).

## Open questions
- **Worker reuse vs per-call:** create a `tesseract.js` worker per call (simple, no shared state)
  vs a pooled worker (faster on repeat). Start per-call (upload is low-volume); revisit if the
  Slice 2d pipeline shows it matters.
- **Dimension source:** read PNG IHDR (works for the committed PNGs) vs trust the engine's reported
  page size. IHDR for now; a non-PNG raster from Slice 2b's rasterizer may change this.
