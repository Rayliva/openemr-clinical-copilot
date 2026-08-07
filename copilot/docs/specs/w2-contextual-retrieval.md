# Spec — Contextual retrieval: clinical query expansion (W2 #7, stretch)

Status: in progress · Traces to: PDF Core Deliverables "Contextual retrieval improvements
such as better chunking, **query rewriting**, or domain-specific filters." Extends
`w2-rag.md` (the hybrid retriever); additive, deterministic, offline.

## Problem

The hybrid retriever's keyword arm scores by exact term overlap. A physician types clinical
**abbreviations** ("a1c", "htn", "bp", "ckd", "ldl") that do not lexically match the guideline
prose ("hemoglobin A1c", "hypertension", "blood pressure", "chronic kidney disease", "cholesterol").
The keyword arm then contributes nothing for those queries, leaning entirely on the dense arm — a
recall gap on exactly the shorthand a clinician uses. This is the "query rewriting / domain-specific
filter" improvement the PDF calls out, and it is deterministic (so it runs offline in CI, unlike a
model-based rewrite).

## Behavior

A pure `expandQuery(query)` expands recognized clinical abbreviations/synonyms to their canonical
terms, keyed to the corpus domain (diabetes primary care). The **keyword** arm of `retrieveEvidence`
searches the expanded query; the **dense** arm keeps the original query (embedding a synonym blob
would dilute the vector, and the dense arm already captures paraphrase). Expansion is:

- **Additive** — the original query terms are preserved; expansions are appended, so an exact match
  never regresses.
- **Deterministic + offline** — a static synonym table, no model call. Runs in CI.
- **Domain-scoped** — only clinically meaningful expansions relevant to the committed corpus
  (glycemic, hypertension, lipids, renal, weight), not a general thesaurus.

Examples: `a1c → + hemoglobin hba1c glycated glycemic`; `htn → + hypertension blood pressure`;
`ckd → + chronic kidney renal egfr`; `ldl → + cholesterol lipid statin`.

## Boundaries

- No change to the dense arm, the RRF fusion, the reranker, the chunker, or the corpus.
- No change to `EvidenceSnippet` (citations/provenance unchanged) — this only widens keyword recall.
- Not a general NLP synonym engine: a curated, auditable table scoped to the corpus. Unknown terms
  pass through unchanged (a non-clinical query is unaffected).
- Deterministic only — no LLM query rewrite on the hot path (would break offline CI + add latency).

## Acceptance criteria

1. `expandQuery(query)` is pure + case-insensitive; appends canonical expansions for recognized
   abbreviations, preserves the original terms, and returns the query unchanged when nothing matches.
2. `retrieveEvidence` uses the expanded query for keyword search and the original for dense.
3. A retrieval test proves the win: a chunk whose text contains the **expansion** term but not the
   **abbreviation** is retrieved for an abbreviation query (keyword arm now contributes), where it
   would not have been on keyword alone before.
4. Existing RAG tests stay green (exact-term queries unaffected; determinism preserved).
5. Offline, no live keys.

## Open questions

None.
