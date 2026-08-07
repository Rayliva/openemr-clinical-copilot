# Spec — W2 OCR port + committed maps (Slice 1)

> The adapter/data side of the box-match. The pure matcher (`docs/specs/w2-ocr-box-match.md`,
> `src/boxMatch.ts`) already consumes an `OcrPage` word→coordinate map as input; this slice
> supplies that map. Engine decision: **in-process `tesseract.js` (WASM) behind an injected
> `OcrPort`, committed fixture maps for offline CI** — `docs/decisions/w2-ocr-engine.md`.
> Traces to Core Req 1 (ingestion), Core Req 5 (citation + box overlay), `w2-eval-gate`
> (offline/deterministic CI), rule `w2-document-ingestion-writes` (never a silent fill).

## Context — the two OCR consumers

1. **CI / offline (this slice, P0):** box-match reads a **committed `*.ocr.json` map**. No OCR
   runs on the graded path — the map is a build-time artifact (reviewed golden), so tests are
   offline + deterministic.
2. **Live upload (Slice 2, later):** a `tesseract.js` adapter behind the `OcrPort` OCRs the
   uploaded raster in-process. Same `OcrPage` output; the port is defined here so the
   extraction path is written against it now.

## Behavior

### B1 — OCR-map wire contract + boundary parser (`src/ocrMap.ts`)
- A Zod schema for the committed map: `{ words: [{ text: string, box: BoundingBox }, ...] }`
  (reusing the existing `BoundingBox`; `box.page` is 1-based, coords [0,1]).
- `parseOcrMap(raw: unknown): OcrPage` — parse-don't-validate at the file boundary. Returns a
  validated `OcrPage` (the shape `boxMatch.ts` already consumes) or **throws** a clear error on
  malformed data (a corrupt/hand-edited committed map is a repo-integrity failure — fail loud,
  never a silent empty map that would degrade every field to `unverified`).

### B2 — the `OcrPort` contract (`src/ocrPort.ts`)
- `OcrRequest = { pages: readonly PageImage[] }` (reuse `PageImage` from `extract.ts`).
- `OcrPort = (req: OcrRequest) => Promise<OcrPage>` — the injected boundary, mirroring
  `VlmExtractPort`. Pure packages import the *type* only; concrete adapters live at the edge
  (`orchestrator-only`). A **committed-map-backed** port (reads a `*.ocr.json`) serves CI/tests;
  the live `tesseract.js` adapter is Slice 2.

### B3 — build-time map generator (`scripts/generate-ocr-maps.mjs`)
- A **devDependency-only authoring script** (like `render-fixtures.mjs`; not a test, never run
  in CI/runtime). Runs `tesseract.js` (`eng` LSTM traineddata) over each committed fixture PNG,
  normalizes each recognized word's pixel box to [0,1] against the raster dimensions, and writes
  `fixtures/w2/<name>.page-1.ocr.json`. Pinned engine/traineddata version; output is a
  **reviewed golden** — regenerate rarely, review the diff.
- Command: `pnpm --filter @copilot/ingestion generate-ocr-maps`.

### B4 — box-match wired into the extraction path against the committed map
- The committed map + the committed lab extraction round-trip through `locateLabResults`:
  loading `<name>.page-1.ocr.json` → `parseOcrMap` → `locateLabResults(extraction, map)` yields
  located boxes for values the OCR found, and `approximate`/`unverified` (never a dropped
  citation) for those it did not.

## Boundaries (what Slice 1 does NOT do)
- **No live OCR / no runtime `tesseract.js` adapter** — that is Slice 2. `tesseract.js` is a
  devDependency here (build-time script only), not a runtime dep.
- **No review UI, no PDF overlay, no persistence/commit** — downstream slices.
- **No change to the pure matcher** (`boxMatch.ts`) or the three-way outcome contract.
- **Single-page only** — the fixtures are one page; multi-page maps stay deferred.

## Acceptance criteria
- `parseOcrMap` returns a valid `OcrPage` for a well-formed map; **throws** for an out-of-[0,1]
  coord, a `page < 1`, a missing `text`, or a non-object.
- `OcrPort` is exported as a type; a committed-map-backed port returns the parsed `OcrPage`.
- `generate-ocr-maps` produces a committed `*.ocr.json` per fixture page whose words validate
  against the schema and whose boxes are in [0,1].
- **Round-trip (offline, no live OCR):** with the committed lab map + the committed lab
  extraction, `locateLabResults` locates the **A1c** value with a single-page box in [0,1]
  (`located`) — and **never drops a citation** for any result. Verified 2026-07-14: the pinned
  `tesseract.js@7` `eng` golden locates **all 8** lab values (A1c, glucose, LDL, HDL, TG, eGFR,
  creatinine, sodium); the round-trip pins the count at 8 so a lossy regeneration fails loudly.
- The `@copilot/ingestion` suite stays green; no new runtime dependency (tesseract.js is a
  devDependency).

## Open questions
- ~~**A1c located vs approximate**~~ **RESOLVED 2026-07-14:** the pinned `tesseract.js@7` `eng`
  golden recognizes every lab value as clean tokens — **all 8 locate**, no approximate/unverified.
  The round-trip pins the count at 8; regenerate-and-inspect the golden rather than loosening the
  matcher if that ever changes.
- **Map file granularity:** one file per page (`<name>.page-1.ocr.json`) to parallel the PNGs;
  a multi-page document would commit one file per page (deferred with multi-page).
- **Intake-form box-match:** `locateLabResults` covers the lab path; an intake-form enricher over
  the same `locateValue` matcher + the committed intake map is a follow-on slice.
