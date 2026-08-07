# Spec — W2 guideline evidence in the answer path

> Feature spec for threading retrieved guideline evidence into generation + the verification gate,
> so the co-pilot can answer a guideline question citing the retrieved evidence — kept **separate
> from patient-record facts** and **separately cited**. Grounded in `Week_2_AgentForge.pdf` Core
> Req 3/5, `w2-multi-agent-orchestration` ("guideline evidence and patient-record facts stay
> separate — never merged into one uncited claim"), `provenance-and-grounding`, `verification-gate`,
> and `../../W2_ARCHITECTURE.md §6`.

## Context — where this sits

The evidence-retriever worker retrieves `EvidenceSnippet[]` (RAG, done) and the graph carries them
in `state.evidence`. But `generate` doesn't see them and the verification gate doesn't accept
guideline citations, so a guideline claim would be dropped. This slice connects the two: guideline
snippets become **citable through the same gate** as chart rows, in their own namespace.

## Behavior

### 1. Evidence into generation (a separate, labeled block)
- `GenerateFn` input gains an optional `evidence?: readonly EvidenceSnippet[]` (backward-compatible;
  existing impls ignore it).
- `renderFacts` adds a **GUIDELINE EVIDENCE** section, rendered **separately** from the chart FACTS,
  each snippet as `[source id: <chunkId>] <doc> › <section>: <text>`.
- The system prompt instructs: guideline recommendations may be answered from this block **citing
  the guideline source id**; guideline statements must **never be stated as a finding in this
  patient's chart**, and a chart fact must never be cited to a guideline id (no merging).

### 2. Evidence into the gate (same whitelist + judge, separate namespace)
- The evidence-retriever worker, on retrieving snippets, folds them into the turn's citable state:
  - `retrievedRefs += snippet.chunkId` (so a claim citing a guideline chunk passes the citation
    check — layer 1).
  - `evidenceIndex[chunkId] = "Guideline (<doc> › <section>): <text>"` (so the grounding judge —
    layer 2 — resolves and grounds a guideline claim against the chunk it cites, never the whole
    corpus).
- Chart rows (row-uuid ids) and guideline chunks (chunk ids) share the ref list but are **distinct
  id namespaces + distinct prompt sections**, so a claim's citation is unambiguously chart-or-guideline.
- The constraint engine (layer 3) is unchanged — it runs on structured **chart** facts only; a
  guideline snippet is never a structured clinical fact and never feeds the constraint engine.

### 3. Degradation unchanged
- No evidence retrieved → the GUIDELINE EVIDENCE block is absent; the answer path behaves exactly as
  today (chart-only). Empty retrieval is "no supporting guideline evidence," never a fabricated cite.

## Boundaries (what this slice does NOT do)
- **No supervisor router / no wire.ts assembly** — activating retrieval in prod (build the corpus
  index at startup, inject the worker + a Claude router) is the next slice. Here the worker port is
  still injected and tested with a stub returning `EvidenceSnippet[]`.
- **No change to the constraint engine or the citation/grounding algorithms** — only the ref set +
  evidence index they consume are extended with the guideline namespace.
- **No overlay/click-to-source UI.**

## Acceptance criteria
- With an injected evidence-retriever returning a snippet, a model claim that cites the snippet's
  `chunkId` **passes** the citation check and appears in the answer (guideline Q&A works end-to-end
  through the gate).
- A claim citing a `chunkId` that was **not** retrieved is still **rejected** (whitelist holds for
  the guideline namespace too).
- The grounding judge grounds a guideline claim against its chunk text (evidenceIndex has the chunk),
  and drops a guideline claim the chunk does not support.
- Chart-only turns (no evidence) are **behaviorally unchanged** and the prompt is unchanged (the
  guideline instruction lives in the evidence block, which is absent) — existing graph/safety/chat
  tests stay green.
- The rendered prompt keeps guideline evidence in a section **labeled distinct** from chart FACTS.
- Guideline snippets never enter the constraint engine (a safety finding is computed from chart
  facts regardless of evidence).

## Known residual (from code review) — separation is soft, not yet structural
Layer 1 (`checkCitations`) enforces set-membership only; it does not bind a claim's *namespace* to
its *phrasing*. So a chart-phrased claim citing a guideline chunk, or one claim citing both a chart
row and a guideline chunk, passes layer 1. The current defenses are **the grounding judge** (it
resolves only the cited guideline text, so a claim asserting a chart value the guideline doesn't
state should fail to ground) **and the prompt instruction**. This matches the accepted design, but
the separation is not deterministic. **Deferred follow-up:** tag each ref with its namespace
(chart|guideline) and have the citation/grounding layer deterministically reject a cross-namespace
citation (a chart-phrased claim citing a guideline id, or one claim mixing both). Tracked as the
next hardening on this path.

## Open questions
- **Query used for retrieval** — the latest user message verbatim for v1; query rewriting is a
  stretch item (PRD).
- **Response labeling** — whether the UI visually distinguishes guideline-sourced claims from chart
  claims (a later click-to-source/overlay concern); the data (distinct source ids) already supports it.
