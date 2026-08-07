---
name: w2-hybrid-rag
description: Build or change the Week 2 hybrid RAG over the clinical-guideline corpus — chunk, embed (Cohere), store in Postgres/pgvector, retrieve dense+keyword fused via RRF, rerank (Cohere), return top cited evidence snippets. Use for any evidence-retriever / guideline-RAG work — corpus curation, chunking, the vector index, hybrid retrieval, reranking, or the packages/rag contract.
---

# Skill: w2-hybrid-rag

## When to use
Any Week 2 guideline-evidence work: curating the corpus, chunking, the pgvector
index, hybrid (dense + keyword) retrieval, reranking, or the `packages/rag` contract.
Backs the **evidence-retriever** worker. See `W2_ARCHITECTURE.md` §6.

## The invariants
- **Guideline evidence is a separate kind of fact from the patient record.** Never
  merge a guideline claim and a chart claim into one uncited statement
  (`provenance-and-grounding`, PDF "Evidence grounding").
- **Answer only from the reranked, retrieved evidence** — never from model priors.
- **Pure module.** All logic lives in `packages/rag`; no LangGraph import
  (`orchestrator-only`). Zod-contracted in and out.
- **Corpus is reproducible from the repo** — committed chunks; the index is
  rebuildable (`w2` backup requirement).

## Steps
1. **Spec first** at `docs/specs/w2-rag.md`: the retrieval contract, corpus sources,
   chunking strategy, acceptance (a known query returns the expected chunk).
2. **Curate the corpus** (non-PHI, PCP-relevant): USPSTF + CDC schedules (public
   domain) + ADA Standards of Care (attribution) — NHLBI/JNC as a public-domain
   fallback. Commit the source-derived chunks to the repo.
3. **Chunk by section with overlap**, retaining `{doc, section, page}` on every chunk.
4. **Embed** each chunk with **Cohere embed v3** (via the model-role abstraction) →
   **agent-owned Postgres/pgvector** (`w2` data layer; not Langfuse's DB, not MariaDB).
5. **Retrieve (hybrid):** dense pgvector ANN **+** Postgres full-text search (exact
   drug names / codes / acronyms), **fused via Reciprocal Rank Fusion (RRF)**.
6. **Rerank** the fused top-N with **Cohere rerank v3** → **top 3–5**; feed only those
   (with `{doc, section, page, chunk_id}` metadata) to the answer model.
7. **Contract:** expose `retrieveEvidence(query)` → `EvidenceSnippet[]`
   (`{doc, section, page, chunk_id, text, score}`), Zod-validated.
8. **Resilience:** timeout + retry on the Cohere calls; **circuit-breaker** on the
   reranker → fall back to fused pre-rerank top-k labeled "unreranked" rather than a
   hung turn (`error-handling-and-logging`, `W2_ARCHITECTURE.md` §17).
9. **Observability:** log retrieval **hits/misses** and rerank scores per encounter;
   `/ready` checks the vector index + reranker reachability (degraded, not binary).
10. **Wire** as the evidence-retriever worker (`w2-supervisor-workers`); add eval
    cases for evidence retrieval + missing-evidence (`add-eval-case`, `week:2`).

## Common pitfalls
- **No-results ≠ negative finding.** Empty retrieval → "no supporting guideline
  evidence found," never a fabricated citation or a prior-based answer.
- **Keyword and dense both matter** — dense alone misses exact drug names/codes;
  keyword alone misses paraphrase. Fuse, don't pick one.
- **Rerank before trusting** — feeding the raw fused list to the model defeats the
  point; rerank down to the few genuinely-relevant chunks.
- **Don't over-egress to Cohere.** The corpus is non-PHI but a query can carry
  patient specifics — documented tradeoff (`phi-and-secrets`); self-host the reranker
  if zero egress is required.
- **ColQwen2 / multi-vector is stretch** — the core is a reliable hybrid retriever.
