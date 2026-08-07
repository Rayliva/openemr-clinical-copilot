# W2 document fixtures

Synthetic, paired document fixtures for the Week 2 Multimodal Evidence Agent. **Synthetic
data only** — not a real patient or real lab result. Spec: `docs/specs/w2-fixtures.md`.

**Anchor patient:** Susan Underwood (pid 2), the established W1 eval ground truth — here
receiving a diabetes follow-up lab panel + a patient intake form (the "recent info buried
in a scanned lab PDF and intake form" from the PDF scenario).

## Files

| Source (edit) | Rendered source doc | Page raster (VLM/OCR input) | Committed OCR map | Ground-truth extraction | Schema |
|---|---|---|---|---|---|
| `susan-lab-panel.html` | `susan-lab-panel.pdf` | `susan-lab-panel.page-1.png` | `susan-lab-panel.page-1.ocr.json` | `susan-lab-panel.extraction.json` | `LabPdfExtraction` |
| `susan-intake-form.html` | `susan-intake-form.pdf` | `susan-intake-form.page-1.png` | `susan-intake-form.page-1.ocr.json` | `susan-intake-form.extraction.json` | `IntakeFormExtraction` |

- **The `.page-1.ocr.json` files** are the committed word→coordinate maps (build-time
  `tesseract.js` golden) the box-match reads **offline in CI** — no OCR runs on the graded
  path. Regenerate after re-rendering a raster (review the diff):
  `pnpm --filter @copilot/ingestion generate-ocr-maps`.

- **The `.html` files** are the human-editable source of truth. Their values match the
  ground-truth extraction exactly (enforced by the drift-guard test).
- **The `.pdf` files** are the realistic source documents (a scanned lab report is a PDF;
  the real front-desk upload lands as a FHIR `DocumentReference` + `Binary`).
- **The `.page-1.png` files** are the per-page rasters the pipeline consumes — the VLM
  reads them, and the click-to-source overlay draws boxes on them. OCR of these rasters is
  **in-process `tesseract.js`** (not a service; decision
  `docs/decisions/w2-ocr-engine.md`): the box slice reads a **committed `*.ocr.json`
  word→coordinate map** offline in CI (regenerated at build time, reviewed golden), while a
  live front-desk upload OCRs the uploaded raster in-process.
- **The `.extraction.json` files** are the expected, schema-valid extraction. They serve
  two roles: (1) the **stubbed VLM output** for offline integration tests (CI without live
  API), and (2) the **eval ground truth** for the 50-case golden set.

**Regenerate the PDF + PNG after editing an HTML fixture** (Playwright is an
authoring-time devDependency only — CI/runtime read the committed assets):

```
pnpm --filter @copilot/ingestion render-fixtures
```

## Guarantees
- Each `.extraction.json` is validated against its schema by
  `packages/ingestion/test/fixtures.test.ts` — a drift out of schema fails CI.
- Bounding-box `locator`s are omitted here (page/section-level citation); real OCR-located
  boxes are produced by the extraction + overlay slices.
- Reproducible from the repo alone (committed) — satisfies the W2 backup requirement that
  the eval golden set not live only in a database.
