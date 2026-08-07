# Spec — W2 hybrid RAG (guideline evidence retrieval)

> Feature spec for the Week 2 evidence-retriever's retrieval stack: a small curated
> clinical-guideline corpus, chunked with provenance, embedded (Cohere) into pgvector,
> retrieved dense + keyword fused via RRF, reranked (Cohere), returning the top cited evidence
> snippets. Grounded in `Week_2_AgentForge.pdf` Core Req 3, the `w2-hybrid-rag` skill,
> `provenance-and-grounding` + `w2-multi-agent-orchestration` (guideline evidence stays separate
> from patient-record facts), `orchestrator-only`, and `../../W2_ARCHITECTURE.md §6`.
> Package: `@copilot/rag` (pure logic; Cohere + pgvector behind injected ports).

## Context — where this sits

The evidence-retriever worker (graph slice, already wired to an injected port) needs a body:
`retrieveEvidence(query) → EvidenceSnippet[]`. This spec covers the whole stack; it is built in
small TDD slices, **pure-first**:
- **Slice 1 (this):** the Zod contracts (`GuidelineChunk`, `EvidenceSnippet`) + **chunking**
  (markdown → provenance-tagged chunks) + **RRF fusion** (fuse two ranked lists). All pure,
  offline, no Cohere/DB.
- **Slice 2 (retrieval core, this):** the pure hybrid retrieve — `cosineSimilarity` + dense search
  over an in-memory embedded index + keyword (term-overlap) search, composed via `fuseRRF` into
  `retrieveEvidence(query, index, embed)`. The embedder is **injected** (`EmbedFn`): a deterministic
  **bag-of-words** embedder ships for **offline/CI** retrieval (no Cohere needed), and the real
  **Cohere embed v3** adapter is a thin concrete impl (next). The in-memory index is the test/small-
  corpus store behind a store-shaped interface; the **pgvector** ANN + Postgres full-text impl is the
  prod store behind the same interface (later).
- **Slice 3:** Cohere **rerank v3** adapter + circuit-breaker fallback.
- **Slice 4:** wire as the evidence-retriever worker + eval cases.

## Corpus (real, public-domain, reproducible in-repo)
Curated non-PHI, PCP-relevant guideline text — **real public-domain sources** (US-government:
USPSTF, CDC, VA/DoD CPGs; NHLBI where public-domain), attributed, committed as markdown under
`packages/rag/corpus/`. First doc: **Type 2 Diabetes glycemic management** (maps to the demo
patient Susan — A1c 8.1 high). Added incrementally (statin/lipids, hypertension, CKD) — each maps
to Susan's chart. The committed markdown + derived chunks make the index **rebuildable from the
repo alone** (`w2` backup requirement).

## Behavior

### Contracts (Zod)
- `GuidelineChunk = { chunkId, doc, section, page?, text }` — one retrievable unit with its
  provenance (`doc` id/title, `section` heading, optional `page`).
- `EvidenceSnippet = { chunkId, doc, section, page?, text, score }` — a retrieved+scored chunk;
  the answer model sees ONLY these (with metadata), never the raw corpus.

### Chunking — `chunkMarkdown(doc, opts?) → GuidelineChunk[]`
- Split a markdown doc **by section** (heading boundaries), retaining the section heading on every
  chunk. A long section is split into **overlapping** windows (default target ~800 chars, ~120
  overlap) so a recommendation spanning a boundary is not lost.
- **Corpus convention:** a level-1 `#` heading is the **document title** (not retrievable — its
  body, e.g. a provenance disclaimer, is not chunked so it can't surface as "evidence"); `##`+ are
  content sections. Nested-heading breadcrumb provenance (a `##`→`###` path) is a later refinement;
  the current corpus is flat.
- Every chunk carries `{doc, section}`; `chunkId` is stable + deterministic (e.g.
  `${docId}::${sectionIndex}::${windowIndex}`) so re-chunking the same doc is idempotent.
- Deterministic + pure — no embeddings here.

### RRF fusion — `fuseRRF(rankedLists, opts?) → RankedItem[]`
- Reciprocal Rank Fusion of ≥1 ranked lists (dense + keyword): each item's score =
  `Σ 1/(k + rank)` across the lists it appears in (`k` default 60), keyed by `chunkId`. Returns
  items sorted by fused score, descending, deterministic on ties (stable by chunkId).
- Pure — the ranked lists are inputs (produced by the retrieval slice); fusion has no IO.

## Boundaries (what this slice does NOT do)
- **No Cohere call, no pgvector, no DB, no network** — embed/store/retrieve/rerank are later
  slices behind injected ports.
- **No graph wiring** — the evidence-retriever worker body is a later slice.
- **No merging with chart facts** — evidence is a distinct kind of fact; the answer path keeps
  guideline claims and patient-record claims separate + separately cited.

## Acceptance criteria
- `chunkMarkdown` on a multi-section doc yields ≥1 chunk per section, each tagged with its section
  heading; a section longer than the window splits into overlapping chunks that together cover the
  section text; `chunkId`s are unique + stable across runs.
- A committed corpus doc chunks without loss (every heading present in the output).
- `fuseRRF` ranks an item appearing high in **both** lists above one appearing high in only one;
  an item in only one list still appears; identical input → identical output (deterministic).
- `fuseRRF` with `k` honored; empty lists → empty result (no throw).
- Contracts reject malformed input (missing `chunkId`/`doc`/`section`/`text`; `score` non-number).
- Pure: no IO, deterministic, no throw on empty/degenerate input.

## Open questions
- **pgvector local dev** — the agent stack has Postgres (Langfuse's) + Redis but no pgvector yet;
  slice 2 adds an **agent-owned** `pgvector/pgvector` container (not Langfuse's DB, not MariaDB).
  For offline tests + CI the retrieval is stubbed, so the DB is only needed for live retrieval.
- **Cohere egress** — the corpus is non-PHI but a query may carry patient specifics (documented
  tradeoff, `phi-and-secrets`); a self-hosted reranker is the zero-egress fallback (slice 3).
- **Exact corpus doc set + versioning** — start with the T2DM doc; the final set + how it's
  version-pinned decided as docs are added (each real + public-domain + attributed).
