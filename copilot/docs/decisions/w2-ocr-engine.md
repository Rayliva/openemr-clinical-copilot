# Decision — W2 OCR engine (box-match word→coordinate map)

> **Status:** proposed (plan-reviewer sign-off incorporated; awaiting final go-ahead to
> amend docs + wire) · **Date:** 2026-07-14
> **Scope:** how the ingestion path produces the page **word→coordinate map** that the
> pure box-match (`packages/ingestion/src/boxMatch.ts`, spec `docs/specs/w2-ocr-box-match.md`)
> consumes. Resolves that spec's open question and the `agent-choices.md` + plan-reviewer
> flow the JOURNAL (2026-07-13 OCR entry) deferred.
> **This deviates from `../../W2_ARCHITECTURE.md` only on topology** (§4.2/§11/§14 say
> "self-hosted Tesseract *service*"): the engine stays Tesseract, self-hosted, in-boundary,
> OCR-on-raster — it moves from a *container* to *in-process WASM*. That narrower change is
> why this goes through the choice-record + plan-reviewer flow before wiring.

## The decision

Produce the OCR word→coordinate map with **`tesseract.js` (WASM Tesseract) running
in-process behind an injected `OcrPort`** — **not** a separate Tesseract *service*
container. The engine is used in **two** places:

1. **Build-time script → committed fixture maps.** A build-time authoring script (a
   devDependency, alongside `render-fixtures.mjs`) runs OCR **once** over each committed
   fixture page raster and commits a `*.ocr.json` word→coordinate map. Box-match unit tests
   and the offline integration test consume these committed maps — so **CI runs zero OCR**,
   fully offline + deterministic (`w2-eval-gate`).
2. **Live in-process adapter → runs at upload.** When the front desk uploads a document
   (the PRD-settled model, `docs/w2-PRD.md §… "Trigger + review UX (settled —
   front-desk-upload model)"`), the pipeline runs `tesseract.js` on the uploaded page raster
   behind the same `OcrPort` to produce boxes for a **genuinely-triggered** click-to-source
   overlay — not a replay of precomputed boxes.

The pure matcher takes the OCR map as **input** and is unchanged either way; this decision
touches only the *adapter/script that produces the map*.

## Why this is a real decision (not a default)

`../../W2_ARCHITECTURE.md` commits to "self-hosted **Tesseract** (a *service*)" in three
places. Choosing in-process WASM is an approach-change to a locked doc → written choice
record + plan-reviewer sign-off before code (JOURNAL convention). The change is **topology
only**: still Tesseract, still self-hosted, still in-boundary, still OCR-on-raster.

## Options

### Option A — Self-hosted Tesseract *service* container (arch-doc default)
Separate Compose container running native Tesseract behind an HTTP wrapper; agent POSTs the
page raster, receives words + boxes.
- **+** Native engine: fastest, multi-threaded; does not block the Node loop.
- **+** Matches the arch doc as written; isolates a heavy C++ dep from the agent.
- **−** A **new container** to build, `/ready`-probe, deploy to **both** Site A and Site B,
  and fold into baselines/alerts — real ops surface for a call that fires a few times per
  demo (extract-once / low-volume).
- **−** HTTP contract + image + a network hop moving the PHI page image between containers.

### Option B — `tesseract.js` in-process, behind `OcrPort` (CHOSEN)
Same Tesseract LSTM engine as WASM, run inside the agent process (build-time script + live
adapter).
- **+** No new container — an npm dep only; Compose/deploy topology unchanged on A + B;
  nothing new for `/ready` to probe.
- **+** The page image never leaves the process — PHI stays in-boundary (same guarantee as
  A, without the inter-container hop).
- **+** Committed fixture maps ⇒ **zero OCR on CI/graded paths** ⇒ offline + deterministic
  for free (`w2-eval-gate`).
- **+** The live in-process adapter makes the front-desk-upload demo **genuine** (boxes are
  computed from the uploaded bytes) at **no extra infra**.
- **−** Slower than native, single-threaded → run the live path in a **worker thread**;
  WASM core (~a few MB) + `eng` traineddata add memory to the agent process.
- **−** Diverges from the arch doc on topology (this record + the amendment resolve it).

## Rationale for choosing B

1. **Extract-once / low-volume** — OCR runs at upload, not per turn. Native throughput buys
   little; a whole extra container on two droplets is a poor trade for a handful of calls.
2. **CI stays offline + deterministic without effort** — committed maps (build-time, same
   pattern as the committed PNGs) mean the eval gate + integration tests never run OCR. The
   heaviest WASM downside (speed/memory) never touches the graded path.
3. **The live demo is genuine and affordable** — in-process OCR runs on the uploaded bytes,
   so a front-desk user uploading a (scanned) PDF sees boxes get *created*, not replayed —
   with no new infrastructure.
4. **Reversible** — `boxMatch` takes the map as input, so swapping to a native service later
   (if real volume ever demands it) touches only the adapter, not the pure matcher.

The native service is the right answer at production scale; at this project's scale it is
ops weight the DO deploy does not need.

## Determinism (the committed maps)

Live-upload OCR nondeterminism is **fine** — it is never on the CI/graded path. The
**committed fixture maps ARE on the CI path**, so they are a **pinned, reviewed golden**:
the build-time script pins the `tesseract.js` engine version + traineddata + page-seg
params; the committed `*.ocr.json` is regenerated rarely and its diff is human-reviewed
(like the layout-field / twig fixtures). This neutralizes cross-environment OCR drift for
the tests because OCR is not *run* on that path — the map is read, not recomputed.

## Traineddata tier

Use the standard **`eng`** trained model (LSTM) rather than `eng.fast`: OCR here is the
**hallucination cross-check**, so accuracy on short numerics (`8.1`, `150/80`, `<5.7`)
matters more than the ~tens-of-MB saved. The blob is a committed/pinned asset, loaded once.

## Consequences / follow-through (build order)

**Slice 1 (CI-critical, offline):** define the injected `OcrPort` (page raster → `OcrPage`
word→coordinate map); the build-time authoring script emits + commits `*.ocr.json` per
fixture page; wire box-match into the extraction path against the committed map; box-match +
offline integration tests go green with **no live OCR**. `packages/ingestion` stays pure —
no `tesseract.js` import there (`orchestrator-only`); the script/adapter live at the edge.

**Slice 2 (demo path):** the live in-process `tesseract.js` adapter behind `OcrPort`, run in
a worker thread, invoked on front-desk upload; live-verify boxes on the fixture raster
(mirrors the VLM live-verify). Optional lightweight "traineddata loadable" self-check on the
live path (no service to `/ready`-probe).

**Docs amended** (topology wording only — "service/container" → "in-process `tesseract.js`
(WASM) behind `OcrPort`"; "self-hosted / in-boundary / Tesseract / OCR-on-raster / reads the
PNG" all remain true): `../../W2_ARCHITECTURE.md §4.2/§11/§14`; `docs/w2-PRD.md` deploy
step + ingestion §; the **auto-loaded** `.claude/skills/w2-ingest-document/SKILL.md`;
`packages/ingestion/fixtures/w2/README.md` (clarify: committed map for CI, live OCR for
upload); `docs/w2-brief.md` + `docs/w2-architecture-defense.html` if they name a service.
Spec `docs/specs/w2-ocr-box-match.md` open question resolved → points here.

**No change** to the pure matcher, its tests, the three-way outcome contract, or `/ready`
(no OCR service exists to probe).

## Rejected / deferred

- **Native Tesseract service container (Option A):** rejected for ops weight vs. call
  volume; the `OcrPort` keeps the swap cheap if a real throughput need appears.
- **PDF embedded text-layer extraction (`pdf.js`):** **rejected**, though it is more
  deterministic and needs no WASM. The PRD scenario is **scanned** documents and the whole
  point of the box-match is OCR-on-raster as an *independent* cross-check of the VLM's
  reading. Text-layer would only work because our fixtures are *accidentally* born-digital
  (HTML→PDF), would collapse on a genuinely scanned upload, and would weaken the
  vision-without-invention story. Off-scenario; not chosen.
- **Cloud OCR (Textract / Google Vision / Azure):** rejected outright — sends the PHI page
  image to a SaaS without a BAA (`phi-and-secrets`, `../../W2_ARCHITECTURE.md §11`
  in-boundary-by-default). Not an option.
- **VLM-for-boxes (ask the vision model for coordinates):** rejected — it would defeat the
  independent cross-check that is the entire purpose of the box-match. Stated so a future
  agent does not "simplify" the OCR step away.

## Open product question (resolved 2026-07-14)

*Does grading/demo ingest only committed fixtures, or can a front-desk user upload an
arbitrary PDF?* → **Both paths built.** Committed fixtures satisfy the offline graded eval
gate; the live front-desk-upload path (Slice 2) makes the demo genuine and matches the
PRD-settled upload model. Because OCR is in-process, the live path needs no new infra.
