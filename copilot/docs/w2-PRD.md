# PRD — Clinical Co-Pilot, Week 2 (Multimodal Evidence Agent)

> **Status:** W2 scope, `/bootstrap-continue w2` planning phase (2026-07-13).
> **Grounded in:** repo-root `Week_2_AgentForge.pdf` (the graded requirements),
> `docs/week2-requirements.html` (the live R/A/G board), `docs/w2-brief.md` +
> `docs/w2-architecture-defense.html` (the locked decisions), and the Week 1
> source-of-truth docs (`../AUDIT.md`, `../USERS.md`, `../ARCHITECTURE.md`).
> **This PRD scopes only the NEW Week 2 work.** It does not restate Week 1 — the
> baseline product is in [`docs/PRD.md`](PRD.md) and stands unchanged. Where this
> PRD and the PDF/source docs disagree, **they win** and this PRD is corrected.
>
> **Week-scoping:** every W2 artifact is `w2`-marked; code is additive on `main`
> (new `packages/*` + graph nodes beside the old, never a fork). See
> `CLAUDE.md` and memory `week-scoping-convention`.

## Summary

Week 2 extends the Week 1 Clinical Co-Pilot from a **structured-chart** agent into a
**multimodal evidence** agent, without loosening a single safety guarantee. It adds
exactly two new *sources of facts* and one *orchestration change*, all of which pass
the **same Week 1 verification gate**:

1. **Document ingestion + extraction** — the agent can *see* a scanned **lab PDF**
   and a **patient intake form**, extract structured facts against strict Zod
   schemas, cite each fact back to its place on the page, and persist the source
   document + derived FHIR records through the OpenEMR module (no duplicate,
   no untraceable records).
2. **Hybrid RAG + rerank** — the agent can retrieve **guideline evidence** from a
   small curated corpus (keyword + dense, fused, then Cohere-reranked) and answer
   guideline questions only from the retrieved, cited evidence.
3. **Supervisor + two workers** — the Week 1 linear graph becomes a small
   **supervisor-routed** graph with an **intake-extractor** worker and an
   **evidence-retriever** worker, with every handoff logged as a traced span.

The load-bearing graded deliverable is the **eval-driven CI hard gate**: a 50-case
boolean-rubric golden set behind a PR-blocking git hook that *demonstrably fails* on
an injected regression. The guiding principle, straight from the PDF's closing note,
is **narrower and stronger**: two document types that work reliably, one
comprehensible graph, quality proven by a CI gate — not a pile of frameworks.

## Problem

Dr. Donna Lee (the Week 1 persona — PCP, `users.id = 6`) is prepping a **follow-up
visit**. The structured chart is in OpenEMR, but the recent, decision-relevant
information arrived as a **scanned lab PDF** and a **front-desk intake form** — neither
of which the Week 1 agent can read. So the three questions that matter at the visit —
*what changed, what should I pay attention to, and what evidence supports the
recommendation?* — cannot be answered from the chart alone.

Three specific hard problems (PDF §"The Hard Problems") make this unsafe if done naïvely:

1. **Vision without invention.** A VLM can read a scanned form *and* hallucinate a
   field label or overstate confidence. An extracted value that isn't actually on the
   page is a patient-safety failure, not a UX blemish.
2. **Evidence must be separable and grounded.** A guideline recommendation and a
   patient-record fact are different kinds of claim; mixing them, or stating either
   without a source, breaks the Week 1 trust contract that already governs the chart.
3. **The graph must stay legible.** Adding workers is the moment an agent becomes a
   black box. The supervisor's routing must be inspectable, and no new path may skip
   the verification gate.

## Users / personas

**Unchanged from Week 1** — one PCP, Dr. Donna Lee, read-only, one bound `pid` per
session (`docs/PRD.md` + `../USERS.md`). Week 2 adds no new persona and no new
authorization surface for the *reader*; it adds a **document-ingestion action**
(upload a file for the patient in context) that is still scoped to the owned `pid`.
The physician's Week 1 non-negotiables carry over verbatim and get *stricter* here:
**speed**, **trust** (one confident hallucination loses her), and **safety framing**
(surface + flag, never diagnose/prescribe).

## Goals & success metrics

Week 2 succeeds when the physician can drop a messy lab PDF and an intake form onto a
patient, ask a grounded question, and get an answer where **every clinical claim is
cited to its exact source** (a page box, a chart row, or a guideline chunk) — and when
a **regression cannot reach the demo** because the CI gate blocks it first.

| Metric | Target | Trace to |
|---|---|---|
| **Eval golden set** | **50 cases**, boolean rubrics only (no 1–10) | PDF Core Req 6 |
| **Boolean rubric categories** | `schema_valid`, `citation_present`, `factually_consistent`, `safe_refusal`, `no_phi_in_logs` — all present | PDF Core Req 6 |
| **CI hard gate** | PR-blocking git hook; **build fails if any category regresses > 5% or drops below its pass threshold**; demonstrably blocks an injected regression | PDF HARD GATE |
| **Safety subset** | **100% pass**, degrade-proof (inherited Week 1 invariant, extended to W2 cases) | `../ARCHITECTURE.md §7` |
| **Extraction fidelity** | Every extracted field is `schema_valid` **and** carries a source citation; **zero** extracted-but-uncited clinical values reach the answer | PDF Core Req 1,2,5 |
| **Citation contract** | 100% of clinical claims carry machine-readable `{source_type, source_id, page_or_section, field_or_chunk_id, quote_or_value}`; lab-PDF facts additionally carry a **visual bounding-box overlay** | PDF Core Req 5 |
| **FHIR round-trip integrity** | Re-ingesting the same document creates **no duplicate** and **no untraceable** records (idempotent by content hash; `derivedFrom` links every derived Observation to its source doc) | PDF §"FHIR integrity" |
| **RAG grounding** | Guideline answers cite only reranked, retrieved chunks; retrieval hit-rate and rerank top-k logged per encounter | PDF Core Req 3,7 |
| **W2 latency SLO** *(proposed — confirm at review)* | **extraction-to-draft-ready** (machine time: VLM + OCR + schema, up to draft — *excludes* human review) **p95 < 30s**; full multimodal answer **p95 < 20s**; chart-only fast path unchanged from W1 (< 8s). Confirm→module-write tracked separately (human-paced). | PDF Eng "SLOs"; W1 measured p95 ~13.7s grounding-on |
| **Per-encounter observability** | tool sequence, latency by step, token usage, cost estimate, retrieval hits, extraction confidence, eval outcome — **no raw PHI** | PDF Core Req 7 |

> **Note on the latency SLO numbers:** grounded in Week 1's measured `/chat` p50 7.5s /
> p95 13.7s (grounding-on) plus the added VLM + OCR + RAG + multi-agent hops. Treated as
> an **open question** below until confirmed against a first real W2 run.

## In-scope features (W2, prioritized)

Priorities map to the PDF checkpoints — **P0 = MVP (Tue)**, **P1 = Early (Thu)**,
**P2 = Final (Sun)**. Each item names the Week 1 mechanism it extends (or "net-new").

1. **W1 tech-debt reconciliation note (P0, prerequisite).** The PDF requires W1 debt
   be *documented and resolved before adding surface area*. Reconciliation is already
   done — all prior work is on `main` (clean tree); this item is the **written note**
   in `W2_ARCHITECTURE.md`: what's live, the known non-blocking debt (Redis Patient
   Snapshot cache still pending; prod drug-name display bug), and the decision to
   build W2 additively on `main`. *Net-new doc; no code.*

2. **Structured extraction schemas (P0).** Strict **Zod** schemas for `lab_pdf`
   (≥ test name, value, unit, reference range, collection date, abnormal flag, source
   citation) and `intake_form` (demographics, chief concern, current meds, allergies,
   family history, source citation), each with validation tests. **The schema is the
   canonical contract — raw VLM output never bypasses it.** *Extends the Zod-first
   boundary discipline (typescript-standards rule).*

3. **Document ingestion + extraction tool (P0).**
   `attach_and_extract(patient_id, document_ref, doc_type)` (or equivalent) for
   `lab_pdf` and `intake_form` — `document_ref` is the OpenEMR `DocumentReference` the
   front desk uploaded (see the trigger note below); a raw `file_path` is a secondary
   form. **Extract-once, then read-as-chart-data:** the VLM runs **once**, never per
   question — the validated result becomes durable FHIR data that later turns read back
   through the normal FHIR path (no re-OCR/re-VLM). Flow: **Claude VLM** reads/extracts
   → **strict Zod schema** validates (raw VLM output can't bypass) → **in-process
   Tesseract OCR** (`tesseract.js` WASM in the agent — not a service container; decision
   `docs/decisions/w2-ocr-engine.md`) locates word-level boxes → **physician confirms**
   (async; boxes +
   per-field confidence) → the **OpenEMR PHP module** persists the derived **FHIR
   Observations** linked `derivedFrom` the source `DocumentReference`, **idempotent by
   document content hash** (re-ingesting the same bytes = no-op; a genuinely different
   document has a different hash and is a new record — VLM non-determinism on identical
   bytes is deliberately suppressed, not "amended"). *Net-new (`packages/ingestion`).*
   - **Write model (settled):** the **sidecar never writes** — it extracts and
     *proposes*; the **module** commits (OpenEMR is the system of record; preserves its
     audit + integrity). The one and only new write in Week 2 is this document
     persistence; everything else stays read-only over FHIR.
   - **Human-in-the-loop write approval (settled):** derived facts do **not**
     auto-commit. **Ingestion + review is a decoupled async pipeline, not a paused chat
     turn** (no LangGraph `interrupt` / cross-service resume in v1): extraction runs,
     produces a **pending-review draft**, and the pipeline ends; the physician reviews
     the values + bounding boxes + confidence **asynchronously** and **confirms** before
     the module writes. A hallucinated lab value written to the chart is the
     highest-stakes W2 failure, so the **human is the authority for the write path**
     (schema gates *shape*; the physician gates *truth*). The **answer graph reads
     already-committed facts** — it never blocks on an un-reviewed document. This is
     distinct from the answer-path LLM critic (feature #9), which never touches a write.
   - **Trigger + review UX (settled — front-desk-upload model):** the front desk
     uploads the doc through OpenEMR's normal **Documents** flow (it lands as a FHIR
     `DocumentReference` + `Binary`, so ingestion **links** to it rather than
     re-storing it). When the physician opens the chart, the **co-pilot widget detects
     un-reviewed documents** for the `pid` — it lists `DocumentReference`s **via FHIR**
     (read-only path preserved; needs new `DocumentReference.read` + `Binary.read`
     OAuth scopes), diffs against its already-committed set, extracts anything new, and
     holds the result as a **pending-review draft** (in the **agent-owned Postgres**,
     *not* the chart — nothing is written pre-confirm). The widget surfaces a **"N
     documents to review" chip** (the notification); the review panel is the
     authorization step; on confirm the module writes the Observations linked
     `derivedFrom` the `DocumentReference`, idempotent by document hash.
     - *Proposed defaults (ingestion spec / open questions):* **lazy detection on
       chart-open** (no background worker/poller in v1; eager background extraction is
       an optional enhancement); **pending drafts in agent Postgres**; source doc stays
       in OpenEMR where the front desk placed it.
   - **Review surface (settled — separate, module-hosted):** the widget launcher
     button carries a **notification badge** (count of un-reviewed docs for the
     patient in context; clears on review). Clicking opens a **roomy, module-hosted
     review surface** (large modal/overlay, *not* the cramped chat column — the review
     is focused data-verification, not conversation). **Two panes:** left = the PDF
     page **screenshot with the extracted region boxed**; right = **one row per
     proposed field** (name · value · confidence), row↔box linked on hover/click. Each
     row has **accept (✓) and edit**; high-confidence fields support **"accept all
     remaining"** so attention is forced only on low-confidence / abnormal values
     (the safety review must not degrade into rote clicking). On confirm the **module
     writes** the Observations (no graph resume — the review is decoupled from any chat
     turn); the physician can then ask the co-pilot in **chat** about the now-committed
     labs. Hosting the surface in the **module** keeps the
     write-authorization UI co-located with the write authority (it fetches drafts +
     box coords from the agent via the session token; confirm posts to the module).
   - **Edit-provenance honesty (settled):** a physician-edited value is recorded as
     **`physician-corrected`** in its citation metadata — the box still points to the
     source region, but the value no longer matches the extracted text, so the
     citation must say so rather than imply the page reads the edited value.
   - **Box-match as a hallucination cross-check (settled — three-way outcome).** The
     VLM produces the *value*; Tesseract OCR produces a page **word→coordinate map**;
     locating a field = matching the VLM's value (or its `quote_or_value`) against that
     map. This match is also a cheap invention check, so each field resolves to one of
     **three** states, never a silent fill:
     1. **value + tight box** → shown with the box, normal confidence.
     2. **value + no tight box, but the text IS on the page** (dup match / normalized
        form / minor OCR drift) → shown, cited to the **page/section**, flagged
        "location approximate."
     3. **value + text NOT found anywhere in the OCR** → possible VLM hallucination or
        failed scan region → **flagged "couldn't verify against page text" and forced
        to the top of review**; never quietly filled in.
     The box-match confidence feeds the per-field confidence the physician sees, so
     weak/failed matches are exactly the fields the "accept-all-remaining" flow forces
     her to look at. A field is **never** committed with **no** citation.

4. **Basic hybrid RAG + rerank (P0).** Curate a small clinical-guideline corpus for
   the PCP profile; chunk by section (keep `{doc, section, page}`); **Cohere embed
   v3** into **agent-owned Postgres/pgvector**; retrieve **dense + keyword** fused via
   RRF; **Cohere rerank v3** → top 3–5; feed only that to the answer model with source
   metadata. *Net-new (`packages/rag`).*

5. **Supervisor + two workers (P0).** Extend the LangGraph graph:
   `assembleContext (safety core, always on) → supervisor → {intake-extractor |
   evidence-retriever} → generate → verification gate → respond`. Supervisor = bounded
   LLM router emitting a **typed Zod decision + logged rationale** (never a black box).
   Workers are **thin wrappers** over `packages/ingestion` / `packages/rag`
   (orchestrator-only rule). Handoffs = **Langfuse child spans**. *Extends the W1
   linear graph.*

6. **Citation contract upgrade + PDF bounding-box overlay (P0/P1).** Extend the W1
   provenance `{source_table, row_uuid, fetched_at}` to the full machine-readable
   shape `{source_type, source_id, page_or_section, field_or_chunk_id,
   quote_or_value}` across chart, document, and guideline sources. **Required:** a
   visual **PDF bounding-box overlay** for lab-PDF facts (OCR-located). *Extends the
   W1 citation check + provenance rule.*

7. **Eval-driven CI hard gate (P0 → the graded centerpiece).** Grow the 7-case
   promptfoo suite to **50 cases** exercising extraction, evidence retrieval,
   citations, refusals, and missing-data behavior, with the five **boolean** rubric
   categories. Wrap in a **PR-blocking git hook** (extend `prek`) that fails on
   > 5%-category-regression / below-threshold; the injected regression is caught
   **deterministically**. Golden set **reproducible from the repo alone**. *Extends
   the W1 eval suite; net-new CI.*

8. **W2 observability + cost tracking (P1).** Per-encounter W2 signals — retrieval
   hits, extraction confidence, routing decisions, per-worker latency, eval outcome —
   into Langfuse spans (supervisor → worker child spans) + the metrics dashboard +
   structured logs, all **PHI-free**. Extend `/ready` to validate **document storage,
   vector index, reranker** with **degraded** (not binary) status. Extend the cost/
   latency report to the W2 flows. *Extends W1 Langfuse/dashboard/alerts/`/ready`.*

9. **Critic (deterministic gate first → thin LLM critic) (P1).** Keep the **existing
   deterministic verification gate ahead** — it already rejects uncited/ungrounded
   claims (no LLM needed for that). Add a **thin LLM critic node last**, scoped only to
   **"unsafe action suggestion"** detection (semantic, what determinism can't do). The
   critic is **veto-only / advisory** — it may tighten (warn, bounded-regenerate,
   withhold) but **never** overrule a deterministic block to let something pass, so
   contraindication/safety *pass* decisions stay deterministic (verification-gate
   rule). *Extends the W1 gate; satisfies PDF's critic deliverable.*

10. **Click-to-source UI + document preview (P1).** Clicking a citation snippet opens
    its source — a chart row, a guideline chunk, or the **document with its bounding
    box highlighted**. Simple document preview in the widget. *Extends the W1 chat
    widget.*

11. **W2 engineering deliverables (P1/P2).** Graded alongside the core:
    **`W2_ARCHITECTURE.md`** (ingestion flow, worker graph, RAG design, eval gate,
    risks, tradeoffs, **testing strategy**, **W2 failure modes / incident response**);
    **OpenAPI 3.0** spec for all W2 endpoints + contract tests; **integration tests**
    over the full ingest→answer path with **fixture documents + stubbed LLM/VLM**
    (pass in CI without live API); **data model + lineage** doc (lab observations,
    intake facts, guideline chunks, citation records — each with owner/lineage/access/
    validation); **PHI audit + CI PHI-detection check**; **backup & recovery** plan
    (RPO/RTO; golden set reproducible from repo); **W2 alerts** (extraction failure
    rate, RAG latency, **eval-regression > 5%**); **dependency audit + security scan**
    on every PR; W2 **API collection** entries; W2 **baselines**. *Mostly extends W1
    equivalents; OpenAPI + PHI-check + data-lineage + backup docs are net-new.*

12. **Integrate + deploy + demo (P2).** Expose the W2 flow in the deployed app
    (extend DO Compose: add **pgvector**, Tesseract/OCR service; blue/green),
    capture traces, refresh the deployed link, and support the 3–5 min demo (user-
    produced) showing upload → extraction → retrieval → citations → eval results →
    observability. *Extends the W1 deploy.*

**Stretch (only after the two document types work reliably):** third document type
(referral fax / medication list); lab-trend chart widget over extracted Observations;
contextual retrieval improvements (better chunking, query rewriting, domain filters).
Explicitly deprioritized per the PDF's "narrower is stronger" note.

## Out-of-scope (W2)

- **No third+ document type** in the core (stretch only) — two types working reliably
  beats five that don't (PDF pitfall #1).
- **No writes to the chart from the sidecar.** The agent stays read-only over FHIR;
  the **only** new write path is document/derived-observation persistence, it goes
  **through the OpenEMR module** (not the sidecar), and it commits **only after
  physician confirm** (human-in-the-loop) — never auto-persisted (defense-deck
  tradeoff + feature #3).
- **No raw-VLM answers.** No extracted value reaches an answer without passing its Zod
  schema and carrying a citation (PDF pitfall #2).
- **No un-separated evidence.** Guideline evidence and patient-record facts are never
  merged into one uncited claim (PDF "Evidence grounding").
- **No LLM-as-judge without a boolean rubric**; no 1–10 scores in the gate (PDF pitfall #4).
- **No hosted observability / no PHI to SaaS tracing.** Langfuse + OCR stay
  self-hosted; the single documented egress is Cohere (non-PHI corpus; a query *may*
  carry patient specifics — documented tradeoff) (PDF pitfall #5).
- **No new authorization model.** One bound `pid`; ingestion is scoped to the owned
  patient exactly as reads are (`authorization-and-pid-scope` rule).
- **No ColQwen2 / multi-vector indexing** — explicitly stretch per the PDF; the core
  is a reliable hybrid retriever.
- **No re-platforming.** Same DO one-VM Compose, extended with pgvector + OCR.

## Constraints

- **Build on Week 1, additively, on `main`.** Reuse the fork, auth flow, tool layer,
  verification gate, observability, and eval harness. W1 debt documented (item #1);
  no fork of the codebase, no archived W1.
- **README separates W1 baseline from W2 multimodal behavior** (graded submission
  requirement) — graders run the core W2 flow without guessing branch/env/service.
- **Same safety spine.** Orchestrator-only (logic in pure `packages/*`, thin nodes),
  Zod-first contracts, three-layer verification gate, provenance/citations,
  minimum-necessary PHI to the LLM, structured PHI-free logs with correlation IDs.
- **FHIR/OpenEMR integrity.** Documents + derived observations round-trip with no
  duplicate/untraceable records; **one source of truth per data type; no silent
  overwrites**; schema changes from W1 carry a **migration note**.
- **CI is now non-negotiable** (reverses the W1 "no CI" decision, but only for the
  eval/quality gate — still operator-driven deploy). GitLab remains source of truth;
  **ask before every commit, push, deploy** (`commit-and-deploy` rule).
- **Schedule (CT):** Architecture Defense +4h · **MVP Tue 11:59 PM** · **Early Thu
  11:59 PM** · **Final Sun Noon**. One-week sprint.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| **VLM hallucinates an extracted field** (top W2 risk). | Zod schema is the canonical gate — raw VLM output can't pass; per-field confidence; every field cited to an OCR-located box; **physician confirms extracted values before they commit to the chart** (human-in-the-loop write approval); extraction regression cases in the golden set; unsupported facts made visible, never silently included. |
| **The CI gate doesn't actually block the grader's injected regression.** | The regression-catching assertions are **deterministic** (schema_valid, citation_present, no_phi_in_logs) and the hook is PR-blocking; we self-test by injecting our own regression and confirming red before submission. |
| **Supervisor becomes a black box.** | Typed Zod routing decision + logged rationale; every handoff a Langfuse child span; routing decisions in the dashboard; a supervisor↔worker contract test in CI. |
| **Duplicate / untraceable FHIR records on re-ingest.** | Idempotent by content hash; `derivedFrom` links; write path confined to the OpenEMR module; round-trip integration test with fixtures. |
| **PHI leaks into traces/logs/eval data/cost reports** (new surface: document images, extracted values). | phi-and-secrets rule; self-hosted OCR + Langfuse; **CI PHI-detection check**; PHI audit doc; eval golden set uses synthetic docs only. |
| **Query egress to Cohere carries patient specifics.** | Documented tradeoff (same concern as self-hosting Langfuse); corpus is non-PHI; self-hostable reranker as the zero-egress fallback. |
| **Latency of VLM + RAG + multi-agent blows the SLO.** | Supervisor routes — optional workers only run when needed; timeouts + retries on all outbound VLM/retrieval calls; ingestion is off the chat fast-path; measure a real run before locking the SLO. |
| **Compressed one-week sprint + a lot of engineering deliverables.** | Strict P0 (MVP: 2 doc types, 2 workers, RAG, the CI gate) before P1/P2; "narrower is stronger"; stretch items only after core is reliable. |
| **Scope creep into a "medical-document platform."** | PDF final note is a design constraint: two reliable document types, one legible graph, quality proven by the gate. |

## Open questions

- **W2 latency SLO numbers** — proposed (ingestion p95 < 30s, answer p95 < 20s);
  confirm against a first real W2 run before locking. *(Decide in tech spec / after
  first measurement.)*
- **Demo-scenario anchor patient + synthetic documents** — which patient carries the
  lab PDF + intake form (extend Susan pid 2, or a purpose-built W2 patient), and the
  exact synthetic docs used as fixtures + eval ground truth. *(Decide in the seed /
  eval spec; must be synthetic and repo-reproducible.)*
- **Guideline corpus sources + versioning** — which real guideline documents, and how
  kept current/versioned. *(Decide in the RAG spec.)*
- **Write path authority detail** — the module writes the source doc + derived FHIR
  Observations; confirm the exact OpenEMR representation (DocumentReference +
  Observation) and the idempotency key. *(Decide in the ingestion spec — carried in
  W2_ARCHITECTURE.md data-authority section.)*
- **Bounding-box "good enough" bar** — **decided (2026-07-13):** three-way outcome
  (tight box / page-level citation "location approximate" / "not found on page →
  forced review"); box-match doubles as a hallucination cross-check; a field is never
  committed with no citation. Detail in feature #3. *(Overlay-reliability tuning still
  in the citation-overlay spec.)*
- **pgvector vs. a dedicated vector DB** — leaning pgvector at this corpus scale
  (Postgres already in-stack); revisit only if retrieval quality/latency demands it.
- **CI host for the PR-blocking gate** — **decided (2026-07-13):** **GitLab CI** as the
  authoritative PR-blocking gate, running on a **self-hosted `gitlab-runner` registered
  on the DO droplet** (`labs.gauntletai.com` has CI/CD enabled but no runner attached),
  **plus a local `prek` hook** for fast feedback. **Fallback:** if the droplet runner
  is problematic, **stop and inform the user** — likely fall back to the local prek
  hook as the authoritative gate (PDF accepts "Git Hook or equivalent"), keeping
  `.gitlab-ci.yml` committed so it activates when a runner exists. The eval gate runs
  **headless on stubbed LLM/VLM + fixtures** (CI-portable, deterministic regression
  detection). See memory `w2-ci-runner-plan`. *(Detailed in W2_ARCHITECTURE.md +
  w2-build-loop.md.)*
