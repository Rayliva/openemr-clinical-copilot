# Spec — W2 VLM extraction engine

> Feature spec for the Week 2 document-extraction engine: turn a document's page
> images into a **schema-valid** `LabPdfExtraction` / `IntakeFormExtraction`, or a typed
> **degraded** outcome — never a silent pass, never raw VLM output that bypassed the
> schema. Grounded in `Week_2_AgentForge.pdf` Core Req 1 (ingestion & extraction) + Req 2
> (schemas), the `w2-document-ingestion-writes` rule ("schema is canonical; malformed →
> bounded retry → degrade with the field flagged"), the `w2-ingest-document` skill (steps
> 3), `orchestrator-only`, and `../../W2_ARCHITECTURE.md §4`.
> Package: `@copilot/ingestion` (pure engine) + a concrete adapter in `apps/agent`.

## Context — where this sits

`packages/ingestion` already owns the **canonical Zod contracts** (`LabPdfExtraction`,
`IntakeFormExtraction`, `Citation`) and the paired ground-truth **fixtures**
(`docs/specs/w2-extraction-schemas.md`, `docs/specs/w2-fixtures.md`). This slice adds the
**engine that produces** those objects from page images, keeping the same DI split the
Week 1 generate path uses: the pure logic lives in the package behind an **injected model
port** (like `GenerateFn` / `createClaudeGenerate`), so it is unit-testable offline with a
stub and the real Anthropic call lives at the edge in `apps/agent`.

This slice is the pure engine + its offline tests. It does **not** call a live model,
render the HTML fixtures to images, locate OCR boxes, persist, or wire the graph — those
are named as follow-on slices below.

## Behavior

### 1. The injected VLM port (the "VLM role")
`VlmExtractPort` is the one boundary this engine calls out through:

```
type VlmExtractPort = (request: VlmExtractRequest) => Promise<unknown>
```

- `VlmExtractRequest = { docType, pages, feedback? }`.
  - `docType` — `"lab_pdf" | "intake_form"`.
  - `pages` — `readonly PageImage[]`, each `{ page:int>=1, mediaType, base64 }`.
  - `feedback` — present **only on a retry attempt**: the formatted schema-violation
    text from the previous attempt, so the model can correct its output.
- The port returns the model's output **already JSON-parsed** into `unknown` (an object),
  **not validated** — validation is this engine's job (parse, don't validate downstream).
- **Transport concerns (timeout, network retry) belong to the port/adapter**, exactly as
  `createClaudeGenerate` owns its `AbortSignal.timeout`. The engine owns only
  **schema-conformance** retries. A port that rejects (throws) propagates — the engine
  does not swallow transport errors as if they were bad output.

### 2. The extraction engine (pure)
`extractLabPdf(port, pages, opts?)` and `extractIntakeForm(port, pages, opts?)` (thin
wrappers over one generic `extractDocument`) run this flow:

1. Call `port({ docType, pages })`.
2. `parse` the raw result against the **canonical schema** for that `docType`. Raw VLM
   output **never** bypasses the schema (`w2-document-ingestion-writes`).
3. On success → `{ status: "ok", extraction, attempts }`.
4. On a Zod failure and attempts remaining → **retry**: call the port again with
   `feedback` = the flattened schema issues. (Bounded by `opts.maxAttempts`, default 2 =
   one retry.)
5. When attempts are exhausted with no valid parse → **degrade**:
   `{ status: "degraded", issues, attempts }` where `issues` names the offending
   field paths. **Never throw on bad model output; never return a partial/coerced
   extraction.** The degraded outcome is what a later review/persist slice surfaces as
   "couldn't extract — needs manual review," and it is the "field flagged" the rule
   requires.

### 3. Outcome type
```
type ExtractionOutcome<T> =
  | { status: "ok";       extraction: T;                 attempts: number }
  | { status: "degraded"; issues: readonly string[];     attempts: number }
```
A discriminated union — the caller matches on `status`; a `degraded` outcome carries no
`extraction`, so an unvalidated value is unrepresentable downstream.

## Boundaries (what this slice does NOT do)
- **No live model call.** The Anthropic-vision adapter (`createClaudeVlm`, using
  `@ai-sdk/anthropic` `generateObject` with image content) is the *next* slice; the pure
  engine only sees the injected port. `packages/ingestion` gains **no** `@ai-sdk`
  dependency (stays pure — `orchestrator-only`).
- **No HTML→image rendering.** The fixtures are HTML; producing the PNG/JPEG the real VLM
  reads (and the demo overlay) is the rendering slice (open question below).
- **No OCR / bounding boxes.** The engine accepts a `Citation.locator` if the model
  emits one, but does not *produce* boxes (that is the OCR/overlay slice). The three-way
  box-match cross-check lives there.
- **No persistence, no FHIR mapping, no graph wiring, no review UI.** Extract-outcome →
  draft → confirm → module-write are downstream slices.

## Acceptance criteria
- A port returning a **well-formed** lab object → `status: "ok"`, `attempts: 1`, and
  `extraction` deep-equals the schema-parsed object (round-trips the committed
  `susan-lab-panel` ground truth).
- A port returning the well-formed **intake** object → `status: "ok"`, `attempts: 1`.
- A port returning **schema-invalid** output on attempt 1 (e.g. a lab result missing its
  `citation`) then **valid** on attempt 2 → `status: "ok"`, `attempts: 2`, **and the
  second `VlmExtractRequest` carried a non-empty `feedback`** mentioning the offending
  field.
- A port returning **always-invalid** output → `status: "degraded"`,
  `attempts === maxAttempts`, `issues` names the offending field path; the call
  **does not throw** and returns **no** `extraction`.
- `maxAttempts` is honored (e.g. `maxAttempts: 1` → no retry, one port call, degrade on
  first failure).
- A port that **throws** (transport error) propagates — not swallowed as a bad-output
  degrade. *(One test asserts the rejection surfaces.)*
- The engine adds **no runtime dependency** to `@copilot/ingestion` beyond `zod` (still
  pure).

## Follow-on slice A — fixture rendering (decided 2026-07-13)

The engine takes `PageImage`s; something must produce them from the committed HTML
fixtures. **Decision:** an authoring-time script renders each fixture to two committed
artifacts, so CI/runtime never render:
- **`<name>.pdf`** — the realistic **source document** (a scanned-lab-report is a PDF; the
  real front-desk upload lands as a FHIR `DocumentReference` + `Binary`). Used by the demo
  and as the source-of-record artifact.
- **`<name>.page-1.png`** — the **per-page raster the pipeline consumes** — the VLM reads
  it, Tesseract OCR (box slice) reads it, and the overlay draws boxes on it. PNG (not
  PDF-direct) because OCR + overlay need a raster regardless of what the VLM can accept.

Rendering tool: **Playwright/Chromium** (already in the workspace store), one page per
fixture (`page.pdf()` + `page.screenshot()`), driven by a committed
`packages/ingestion/scripts/render-fixtures.mjs`. The HTML stays the human-editable source
of truth (its values are drift-guarded against the ground-truth JSON); the PDF/PNG are
regenerated from it by the script when it changes. Playwright is an **authoring-time**
devDependency only — the committed PNG/PDF are what CI and the pipeline read.

## Follow-on slice B — the Claude-vision adapter (decided 2026-07-13)

`createClaudeVlm` in `apps/agent` implements `VlmExtractPort` with `@ai-sdk/anthropic`
`generateObject`, building an image content block per `PageImage` and appending `feedback`
on a retry. **Model: `claude-opus-4-8`** (vision) — extraction is *once per document*
(low-volume, high-stakes), so accuracy is worth the tier; the chat path stays Sonnet. The
model is an **injected label** via the wire options (never hardcoded — matches `modelName`
/ `groundingModelName`); the same `ANTHROPIC_API_KEY` covers it. Offline tests assert the
request construction (image blocks, schema, feedback) against a stubbed model; a real call
is a paid VERIFY step against the committed PNG.

## Open questions (remaining)
- **Multi-page documents.** `pages` is already a list; the demo fixtures are single-page.
  Page-spanning results (a value on p1 cited to p2) are deferred until a multi-page
  fixture exists.
- **Per-field degrade granularity.** This slice degrades the **whole document** on an
  unrecoverable parse. A future refinement could accept the valid subset and flag only
  the failing fields; deferred — whole-doc degrade is the safe default (no partial commit
  path exists yet anyway, since persist is downstream and physician-gated).
