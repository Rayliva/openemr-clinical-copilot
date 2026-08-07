# Spec — W2 OCR box-match (three-way citation locator)

> Feature spec for locating an extracted value on the page and turning that into the
> three-way citation outcome — the hallucination cross-check between what the VLM *said* and
> what the page *shows*. Grounded in `../../W2_ARCHITECTURE.md §4.2–4.3`, `Week_2_AgentForge.pdf`
> Core Req 5 (citation + PDF bounding-box overlay), the `w2-document-ingestion-writes` rule
> ("no fact commits without a citation; box-match is three-way; never a silent fill"), and the
> `w2-ingest-document` skill step 4. Package: `@copilot/ingestion` (pure).

## Context — where this sits

The VLM adapter (`docs/specs/w2-vlm-extract.md`) produces values + a `quoteOrValue` per
field, but **no bounding box** (`Citation.locator` absent). Separately, an OCR engine
(**in-process `tesseract.js` (WASM)** behind an injected `OcrPort` — decision
`docs/decisions/w2-ocr-engine.md`, resolving the former open question) produces a page
**word→coordinate map**: committed at build time for offline CI, run live in-process on a
front-desk upload. This slice is the **pure matcher** that consumes that map + an extracted value and
decides where (and whether) the value is really on the page. It takes the OCR map as **input**
— it does not run OCR — so it is fully offline-testable with a hand-authored map and commits
to no OCR engine.

## Behavior

### Inputs
- `OcrWord = { text: string, page: int>=1, box: BoundingBox }` — one recognized word and its
  [0,1]-normalized box (reusing the existing `BoundingBox`).
- `OcrPage = { words: readonly OcrWord[] }` (one page; multi-page is a list, deferred).

### The matcher — `locateValue(value, ocr, opts?) → LocateResult`
Locate a target string (a field's `value`, e.g. `"8.1"`, `"150/80"`, `"<5.7"`) in the OCR
words. Normalization before compare: lowercase, trim, collapse internal whitespace; compare on
that normal form so casing/spacing/OCR-spacing drift does not cause a false miss. A target may
span **contiguous** OCR words (`"150 / 80"` → three words) — the match joins a contiguous run.

Three-way outcome (never a silent fill — `w2-document-ingestion-writes`):
| Outcome | When | `LocateResult` |
|---|---|---|
| **located** | a contiguous run of OCR words equals the normalized target | `{ state: "located", box, boxConfidence }` — `box` = the union of the matched words' boxes |
| **approximate** | every target token appears as a **whole word** on the page but not as one contiguous run (a genuinely present multi-token value OCR split/reordered) | `{ state: "approximate", boxConfidence }` — **no** box; cite page/section, flag "location approximate" |
| **unverified** | the target's core token is not found in the OCR at all (possible VLM hallucination / failed scan region) | `{ state: "unverified", boxConfidence: 0 }` — flag "couldn't verify against page text," force to top of review |

`boxConfidence` in [0,1]: `located` high (e.g. 1.0 exact contiguous), `approximate` mid (e.g.
0.5), `unverified` 0. It is a **separate** signal from the VLM's per-field `confidence`; a later
slice combines them into the review-attention ordering (weak/failed match = forced review).

### Enriching an extraction — `locateLabResults(extraction, ocr) → LocatedExtraction`
Walk a `LabPdfExtraction`; for each result, run `locateValue(result.value, ocr)`; return the
extraction with each result's `citation.locator` **set when `located`** (left absent for
`approximate`/`unverified`), plus a parallel per-result `match: { state, boxConfidence }`. The
citation is **never dropped** — an `approximate`/`unverified` result keeps its page/section
citation and is flagged for review. (Intake-form enrichment is a follow-on; same matcher.)

## Boundaries (what this slice does NOT do)
- **No OCR.** The word→coordinate map is an input; running Tesseract (or choosing the OCR
  engine) is a separate slice.
- **No review UI, no confidence *fusion*, no persistence.** This produces the located
  citation + match state; ordering review attention and committing are downstream.
- **No mutation of the `Citation` schema** beyond setting the existing optional `locator`. The
  `match` state rides alongside in the result type, not inside `Citation` (keeps the canonical
  contract stable — data-authority rule).
- **No fuzzy/edit-distance matching** in slice 1 (normalized exact + contiguous only); OCR
  character-error tolerance is a documented later refinement.

## Acceptance criteria
- A value present as one OCR word (`"8.1"`) → `located`, `box` equals that word's box,
  `boxConfidence` high.
- A value spanning contiguous words (`"150/80"` as `"150" "/" "80"`) → `located`, `box` = the
  union of the three boxes.
- A value whose tokens all appear as whole words on the page but only non-contiguously →
  `approximate`, **no** box.
- A value absent from the OCR entirely → `unverified`, `boxConfidence` 0.
- **Safety:** a value that is only a *substring* of a different page number (fabricated `"40"`
  vs page `"140"`; `"8.1"` vs `"138.1"`) is `unverified` (forced review), **not** `approximate`
  — whole-word matching, so a hallucinated value cannot read as "present" off another number's
  digits. A located/approximate run never crosses a page boundary.
- Case/whitespace drift (`"8.1 %"` target vs `"8.1" "%"` words) still matches `located`.
- `locateLabResults` sets `locator` only on `located` results, never drops a citation, and
  returns a `match` state per result; a fixture round-trip (the committed lab ground truth +
  a hand-authored OCR map) yields a `located` A1c with a plausible box.
- Pure: no IO, no OCR dependency; deterministic.

## Open questions
- ~~**OCR engine choice**~~ **RESOLVED 2026-07-14** (`docs/decisions/w2-ocr-engine.md`,
  plan-reviewer-signed): **in-process `tesseract.js` (WASM) behind an injected `OcrPort`**,
  not a service container. Two consumers — a build-time script commits `*.ocr.json` maps for
  offline CI (reviewed golden, pinned engine/traineddata), and a live in-process adapter
  runs OCR on a front-desk upload. PDF text-layer extraction was considered and rejected
  (off-scenario: the docs are nominally *scanned*, and OCR-on-raster is the point of the
  independent hallucination cross-check).
- **Value vs quote as the match target** — slice 1 matches on `value` (tight, precise box);
  the whole-row `quoteOrValue` the VLM currently returns is a coarser fallback, deferred.
- **Character-error tolerance** (OCR misreads `l`/`1`, `O`/`0`) — normalized-exact only for now;
  edit-distance tolerance is a later refinement, documented as an accepted fixture-scope risk.
- **Residual false-`located` risk (concatenation):** because a contiguous run compares the
  space-stripped concatenation of adjacent words, a fabricated value that exactly equals two
  adjacent unrelated cells joined (`"10080"` = cells `"100"`+`"80"`) could locate with a
  two-cell union box. Low probability for realistic lab values and bounded by the overshoot
  break, but not eliminated. Mitigation (deferred): geometry-adjacency (require a bounded gap
  between joined words) once line/word spacing is available from the OCR engine.
- **Multi-page** — `OcrPage` is single-page here; a multi-page document maps value→page,
  deferred until a multi-page fixture exists.
