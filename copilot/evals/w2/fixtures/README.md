# W2 golden-set fixtures

The Week 2 golden set (`evals/w2/cases/`) is **data-only** and reuses the committed, synthetic
document fixtures under `packages/ingestion/fixtures/w2/` rather than duplicating them:

| `documentFixtureId` | Backing fixtures (relative to `copilot/`) |
|---|---|
| `fixture-susan-lab-panel` | `packages/ingestion/fixtures/w2/susan-lab-panel.{pdf,page-1.png,page-1.ocr.json,extraction.json}` |
| `fixture-susan-intake-form` | `packages/ingestion/fixtures/w2/susan-intake-form.{pdf,page-1.png,page-1.ocr.json,extraction.json}` |

Each ingestion case's `fixtureRefs` list points at those paths. The `documentFixtureId` matches the
`sourceId` inside the committed `*.extraction.json` (the stubbed VLM/OCR output the offline runner
keys off), so the golden set is **reproducible from the repo alone** — no database, no live API.

**Synthetic data only.** The anchor patient (Susan Underwood, pid 2) is the W1 eval ground truth;
no real patient, no real PHI. If a future case needs a fixture that does not yet exist, add a small
new one *here* (not under `packages/`) and reference it by a new `documentFixtureId`.
