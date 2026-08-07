# Week 2 brief — Clinical Co-Pilot (seed for `/bootstrap-continue w2`)

Purpose: the crystallized Week 2 plan + the tech-stack / architecture decisions locked in
the 2026-07-13 architecture-defense prep session. `/bootstrap-continue w2` reads this in
Phase 0 to ground `docs/w2-PRD.md`, `W2_ARCHITECTURE.md`, the new `w2-*` skills/rules, and
`docs/w2-build-loop.md` — **do not re-litigate settled decisions**; interview only to fill
genuine gaps.

**Sources of truth:** repo-root `Week_2_AgentForge.pdf` (requirements),
`docs/week2-requirements.html` (R/A/G tracker), `docs/w2-architecture-defense.html` (the
architecture deck these decisions come from). Week-scoping rules: `CLAUDE.md` + memory
`week-scoping-convention`.

## Scope — "Multimodal Evidence Agent"
Extend the Week 1 agent with two new capabilities + one regression gate:
1. Ingest a **lab PDF** and an **intake form** → extract structured facts with citations.
2. **Hybrid RAG + rerank** over a small clinical-guideline corpus.
3. **Supervisor + 2 workers** (document-extractor, evidence-retriever).
4. **50-case boolean-rubric eval CI gate**, PR-blocking (the graded hard gate).
5. Integrate into the deployed app + observability + demo.

## Guiding principle
Extend the Week 1 safety spine (LangGraph orchestrator-only, Zod contracts, verification
gate, provenance/citations, self-hosted Langfuse, DO Compose) — new capabilities are new
*sources of facts* that all pass the same gate. Narrower-but-stronger. Clinical logic stays
in pure `packages/*`.

## Locked tech decisions (by stage)
**Ingestion / extraction**
- **Claude (VLM)** via Vercel AI SDK `generateObject` → **strict Zod schemas** for `lab_pdf`
  + `intake_form` (schema = canonical contract; raw VLM output never bypasses it; per-field
  confidence).
- **Tesseract (self-hosted OCR)** for word-level bounding boxes → the visual overlay.
  Self-hosted so PHI-bearing document images stay in-boundary. (VLM reads/extracts; OCR
  locates.)
- Persist via the **OpenEMR PHP module** (not the sidecar): store the **source document** +
  derived **FHIR Observations**, linked `derivedFrom`, idempotent (hash key) → traceable, no
  duplicates. Keeps the sidecar read-only over FHIR / out of MariaDB.

**Hybrid RAG**
- Small guideline corpus (real guidelines for the PCP persona); chunk by section with
  overlap; keep `{doc, section, page}`.
- **Cohere embed v3** embeddings; **pgvector + Postgres full-text** hybrid (dense + keyword,
  fused via RRF) in an **agent-owned Postgres/pgvector** (not Langfuse's DB, not MariaDB);
  **Cohere rerank v3** → top 3–5. Pure `packages/rag`, Zod-contracted.

**Multi-agent**
- Extend the existing LangGraph graph:
  `assembleContext (safety core) → supervisor → {document-extractor | evidence-retriever} →
  generate → verification gate → respond`.
- Supervisor = bounded LLM router emitting a **typed Zod decision** + logged rationale.
  Workers thin over `packages/ingestion` + `packages/rag`. Handoffs = **Langfuse child spans**.

**Eval gate**
- Two tiers: **Vitest** deterministic (schema-valid, supervisor↔worker contract, integration
  with **fixture docs + stubbed VLM/LLM**, **PHI-detection scan**) + **promptfoo** 50-case
  boolean golden set (`schema_valid, citation_present, factually_consistent, safe_refusal,
  no_phi_in_logs`).
- **PR-blocking git hook** (extend prek); the injected-regression case is caught
  **deterministically**. Safety subset stays 100%.

**Cross-cutting**
- Correlation ID into every W2 hop; W2 Langfuse spans (supervisor→worker child spans); W2
  dashboard metrics; `/ready` checks doc storage + vector index + reranker; **OpenAPI 3.0**
  for W2 endpoints; **W2_ARCHITECTURE.md** (ingestion flow, worker graph, RAG, eval gate,
  risks, testing strategy, failure modes); data-model/lineage + backup (RPO/RTO) docs; PHI
  audit + CI PHI check.
- **In-boundary by default:** self-host OCR (Tesseract) + Langfuse. The one hosted egress is
  Cohere (embed + rerank) — corpus is non-PHI, but a query can carry patient specifics
  (documented trade-off; self-host the reranker if we need zero egress).
- Deploy: extend DO Compose (add pgvector), blue/green.

## Open questions (decide during planning)
- **Write path:** agent writes via FHIR vs. the module writes OpenEMR records directly (data
  authority).
- **Bounding-box overlay:** reliability + what's "good enough."
- **Guideline corpus:** which sources, how kept current / versioned.
- **Latency:** VLM + RAG + multi-agent under an acceptable p95.
- **pgvector vs. a dedicated vector DB** (leaning pgvector at this scale).
- **Critic agent** vs. reusing the existing verification gate.

## Do not step on Week 1
Week 1 stays untouched: `docs/PRD.md`, `docs/tech-spec.md`, `docs/build-loop.md`,
`docs/week1-requirements.md`, existing `.claude/skills/*` + `.claude/rules/*`. All Week 2 outputs
are **w2-marked** (`docs/w2-*.md`, `W2_ARCHITECTURE.md`, new `w2-*` skills/rules, eval cases
tagged `week:2`). Code is additive (new `packages/*` beside the old). See memory
`week-scoping-convention`.
