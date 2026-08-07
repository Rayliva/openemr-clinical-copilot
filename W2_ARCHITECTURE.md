# W2_ARCHITECTURE — Clinical Co-Pilot, Week 2 (Multimodal Evidence Agent)

> **Scope.** This document is the Week 2 architecture, mandated by
> `Week_2_AgentForge.pdf`. It covers the **new** Week 2 surface — document ingestion,
> the supervisor/worker graph, hybrid RAG, the eval CI gate, W2 observability, the data
> model, testing strategy, failure modes, and backup/recovery — layered on the Week 1
> spine. Week 1's architecture is in [`ARCHITECTURE.md`](ARCHITECTURE.md) and stands
> unchanged; this doc names what carries over vs. what is new rather than restating it.
>
> **Grounded in:** `Week_2_AgentForge.pdf` (requirements), `copilot/docs/w2-PRD.md`
> (the W2 product decisions), `copilot/docs/w2-brief.md` +
> `copilot/docs/w2-architecture-defense.html` (locked decisions), `AUDIT.md`,
> `USERS.md`, `ARCHITECTURE.md` (Week 1 sources of truth). Where any of those and this
> doc disagree, **they win**.
>
> **Design thesis (from the PDF's closing note):** *narrower and stronger.* Two
> document types that work reliably, one legible graph, quality proven by a CI gate —
> not a pile of frameworks. Every new capability is just a **new source of facts** that
> passes the **same Week 1 verification gate**.

> **Shipped vs planned (read this first).** This doc describes the target architecture;
> a few pieces are deliberately *lighter* in what ships today. Where they differ, the
> shipped reality wins — the differences are called out inline and summarized here:
>
> | Concern | **Shipped today** | Planned / optional (not deployed) |
> |---|---|---|
> | Guideline RAG store | **In-memory** index in `packages/rag` (deterministic bag-of-words embedder offline/CI; injected **Cohere** embed + rerank in prod) | **Postgres + pgvector** hybrid store — a scale enhancement, not required at demo corpus size |
> | Eval CI gate host | **Local pre-push git hook** (`copilot/scripts/eval-gate.sh`, auto-installed via `pnpm install`'s `prepare`) — offline, full-suite + golden self-test, authoritative | **GitLab CI runner on the droplet** — *considered and dropped* (droplet contention); no `.gitlab-ci.yml` in the repo |
> | Pending-review drafts | Agent's own **in-boundary Redis** (TTL-bounded draft cache) | — (no agent Postgres container ships) |
> | Redis Patient Snapshot cache | Not built (documented W1 debt) | Optional performance item |
>
> Everything else in this doc — the write path (§4/§12), the supervisor+workers graph
> (§5), the verification gate (§10), observability (§9), and the eval gate mechanics
> (§8) — matches the code as shipped.

---

## 1. What carries over from Week 1 — unchanged

These are **not** re-decided in Week 2. New work composes on them additively (new
`packages/*` + graph nodes beside the old, one monorepo on `main`; see
`copilot/CLAUDE.md` week-scoping convention).

| Area | Carried-over decision |
|---|---|
| Service shape | Separate **TypeScript sidecar** (Fastify + SSE); clinical logic never in PHP. Thin OpenEMR module for UI + identity bridge + **writes**. |
| Orchestration | **LangGraph.js**, **orchestrator-only** — nodes are thin wrappers over pure `packages/*`; packages never import LangGraph. |
| Contracts | **Zod-first** at every boundary; JSON Schema exported from Zod; parse-don't-validate at the edge. |
| Read path | Chart read **only** via OpenEMR **FHIR/REST** with a scoped SMART backend-services OAuth2 client. Agent **never** connects to MariaDB. |
| AuthZ | One bound `pid` per session from a **boundary-#1 HMAC token**; `pid` never from model/user input; ownership re-checked every request. |
| Verification | Deterministic **citation check** → LLM **grounding judge** (sees only cited source) → deterministic **constraint engine** on structured facts. Degrade, never silent-fail. |
| Provenance | Every fact carries provenance; absence ≠ negative finding; stale/partial data labeled. |
| Observability | **Self-hosted Langfuse** (span/latency/tokens/cost per node), correlation ID end-to-end, pino structured PHI-free logs, `/health`+`/ready`, metrics dashboard, alerts, on-call runbook. |
| Model tiering | Claude **Sonnet** default; **Opus** for hard synthesis; **Haiku** as the grounding judge. Via Vercel AI SDK. |
| Deploy | **DigitalOcean one-VM Docker Compose**; self-hosted by default; ask before every commit/push/deploy. |

**Model-role note (new tier):** Week 2 adds a **VLM role** (document extraction) and an
**embedding + rerank role** (RAG). VLM = **Claude** (vision) via the AI SDK; embeddings +
rerank = **Cohere** (embed v3 / rerank v3) — the one documented egress (see §11).

## 2. Week 1 tech-debt note (PDF requirement)

The PDF requires W1 debt be *documented and resolved before adding surface area*.
Status at W2 kickoff (2026-07-13):

- **Reconciled:** all prior W1 work is on `main` (clean tree; `main == origin/main`).
  The stale `feat/floating-agent` branch is *behind* main and can be deleted. W2 builds
  additively on `main`.
- **Known non-blocking debt, carried (not code-in-tree):**
  - **Redis Patient Snapshot cache** not yet built — the W1 load test showed a
    50-concurrent cliff caused by ~5 FHIR reads/turn amplification. W2 adds more reads
    (documents), so the cache is more valuable now; it remains an **optional
    performance item**, not a W2 gate.
  - **Prod drug-name display bug** (documented in W1 notes) — cosmetic in the deployed
    demo; does not affect correctness on the local eval ground truth.
- **Resolution posture:** neither blocks W2 core; both are recorded here and in the W1
  tracker so they are visible, not silently inherited.

## 3. System context

```
                         ┌──────────────────────── OpenEMR (system of record) ────────────────────────┐
                         │  MariaDB   ·   FHIR/REST API   ·   Documents store   ·   oe-module-copilot   │
                         └──────▲───────────────▲────────────────────▲──────────────────────▲──────────┘
       front desk uploads       │ read (FHIR)   │ read (FHIR)         │ WRITE (module)       │ mint token / host review UI
       lab PDF + intake form ───┘               │                    │                      │
                                                │                    │                      │
   Physician (browser) ──chat/SSE──►  ┌─────────┴────────────────────┴──────────────────────┴──────────┐
   floating widget + review surface   │                    Agent Service (TS sidecar)                    │
                                       │  Fastify · LangGraph graph · pure packages/* · verification gate │
                                       └───┬───────────────┬───────────────┬───────────────┬────────────┘
                                           │ snapshot cache │ vectors+drafts │ traces         │ VLM / embed+rerank
                                       ┌───▼───┐      ┌─────▼──────┐   ┌─────▼─────┐    ┌──────▼───────┐
                                       │ Redis │      │ in-memory  │   │ Langfuse  │    │ Claude (VLM) │
                                       │ drafts│      │ RAG index  │   │ (+its PG) │    │ Cohere (RAG) │
                                       └───────┘      └────────────┘   └───────────┘    └──────────────┘
                                        in-boundary (droplet Compose)                    egress (BAA/tradeoff)
```

All boxes except Claude and Cohere are **in-boundary** on the DO droplet Compose stack.
Cohere is the single documented egress (§11).

> **Note (shipped).** The RAG index is **in-memory in the agent process** today, not a
> Postgres/pgvector container (see the Shipped-vs-planned table above and §6). The
> agent's **Redis** holds the Patient Snapshot cache (W1, optional) *and* the
> pending-review ingestion drafts (§4.2); there is **no agent-owned Postgres** in the
> shipped stack — the only Postgres is Langfuse's own backing store.

## 4. Document ingestion flow

The one new **write** path in Week 2. The sidecar **extracts and proposes**; the
**OpenEMR module commits** (OpenEMR stays the system of record). Extract **once** at
upload; thereafter the derived facts are ordinary FHIR chart data read back through the
normal path — no re-VLM per question.

**4.1 Trigger + detection (front-desk-upload model).**
1. Front desk uploads a lab PDF / intake form via OpenEMR's normal **Documents** flow →
   it lands as a FHIR **`DocumentReference` + `Binary`** on the patient. Ingestion
   **links** to it; it does not re-store the source.
2. Physician opens the chart → the **floating widget** binds to the `pid` and calls the
   agent's pending-docs endpoint. The agent lists the patient's `DocumentReference`s
   **via FHIR** (new scopes `DocumentReference.read` + `Binary.read`) and treats
   supported PDFs as pending. Duplicate suppression is enforced at the **write** step,
   not by a separate hash store: the module refuses to re-insert an `Observation` for the
   same source document + code + value (§4.5), so re-opening a chart never double-writes.
3. **Lazy detection on chart-open** in v1 — no background worker/poller. Eager
   background extraction is a documented later enhancement.

**4.2 Extraction (`packages/ingestion`, pure).**
`attach_and_extract(patient_id, file_path|document_ref, doc_type)` for `lab_pdf` and
`intake_form`:
- **Claude VLM** reads the page image(s) → proposes structured fields **and** a
  `quote_or_value` per field (the text it believes it read).
- **Strict Zod schema** validates the VLM output. **The schema is the canonical
  contract — raw VLM output can never bypass it** (PDF engineering req). Malformed →
  bounded retry → degrade with the field flagged, never a silent drop.
- **Tesseract OCR** — **in-process `tesseract.js` (WASM), self-hosted inside the agent**
  (not a service container; decision `copilot/docs/decisions/w2-ocr-engine.md`) — produces a
  page **word→coordinate map**. For committed fixtures the map is generated **once at build
  time and committed** (CI runs no OCR, offline + deterministic); a live front-desk upload
  runs OCR in-process on the uploaded raster. Each field is located by matching its value /
  `quote_or_value` against that map → **three-way outcome** (§4.3).
- Result is held as a **pending-review draft** in the agent's **in-boundary Redis**
  draft cache (TTL-bounded, `apps/agent/src/ingestion/draftCache.ts`) so a document is
  extracted **once** and the review modal opens on a cache hit — **not** the chart
  (nothing is written pre-confirm).

**4.3 Box-match = hallucination cross-check (three-way, never a silent fill).**

| Outcome | Meaning | Handling |
|---|---|---|
| value + **tight box** | value located precisely | show with box, normal confidence |
| value + **no tight box, text on page** | dup match / normalized form / OCR drift | show, cite **page/section**, flag "location approximate" |
| value + **text not in OCR at all** | possible VLM hallucination / failed region | flag "couldn't verify against page text," **force to top of review** |

Box-match confidence feeds per-field confidence. **A field is never committed without a
citation.**

**4.4 Human-in-the-loop review + write approval.** Derived facts do **not** auto-commit.
- The widget launcher shows a **notification badge** (count of un-reviewed docs for the
  patient in context).
- Clicking opens a **roomy, module-hosted review surface** (large modal/overlay, not the
  chat column): **left** = PDF page screenshot with extracted regions **boxed**;
  **right** = one row per proposed field (name · value · confidence), row↔box linked;
  **accept (✓) / edit** per field; **"accept all remaining"** for the high-confidence
  set so attention concentrates on low-confidence / abnormal fields.
- A **physician-edited** value is recorded `physician-corrected` in its citation
  metadata (the box still points to the region; the value no longer matches the page
  text, so the citation says so — no implied "the page reads this").
**Decoupled, not an in-graph interrupt (v1).** Extraction + review is its **own async
pipeline**, not a paused chat turn: extraction produces the pending-review draft and
**ends**; the physician reviews and confirms **out-of-band** in the module surface;
confirm triggers the module write. There is **no LangGraph `interrupt`** and no durable
cross-service graph-resume in v1 — this deliberately removes checkpointer + module→sidecar
resume infra from the critical path. (Synchronous in-chat extraction with `interrupt` is a
documented later option, per the W1 tech spec's rationale for choosing LangGraph.)

**4.5 Persist (module write) + FHIR integrity.** On confirm, the **module** writes:
- derived **FHIR `Observation`** records (lab values / intake facts), each linked
  **`derivedFrom`** the source `DocumentReference`;
- **idempotent by (source document + observation code + value)** — the writer
  (`DerivedObservationWriter::commit`) checks `form_observation` for an existing row
  with the same `ob_documentationof_table_id` (the source `DocumentReference`), `code`,
  and `ob_value` before inserting; a match is a **no-op** (`SkippedDuplicate`), so
  re-confirming the same extracted value never duplicates it and re-opening the chart
  never re-writes. A **genuinely different** document (different `DocumentReference`) is
  a new record.
- **Data authority:** one source of truth per data type; **no silent overwrite**.

## 5. Multi-agent graph — supervisor + two workers

Extends the W1 linear graph. **Orchestrator-only** holds: the supervisor and workers are
thin nodes; all logic lives in pure packages.

```
assembleContext (safety core, always on)
        │
        ▼
   supervisor ──►  routes on a typed Zod decision {need_extract, need_evidence, ready}
     │   │
     │   ├─► intake-extractor worker     (thin over packages/ingestion)   ─┐
     │   └─► evidence-retriever worker   (thin over packages/rag)          │
     │                                                                     │
     ◄─────────────── loop until decision = ready ◄───────────────────────┘
        │
        ▼
    generate ─► verification gate (citation → grounding → constraint) ─► LLM critic ─► respond
```

- **Safety core always runs** (`assembleContext`): demographics, problems, meds,
  allergies — the constraint engine needs them every turn regardless of the question.
- **Supervisor** = a bounded LLM router emitting a **typed Zod decision + a logged
  rationale** (never a black box — PDF pitfall). It decides *when* extraction is needed,
  *when* evidence retrieval is needed, and *when* the answer is ready.
- **intake-extractor worker** — thin wrapper over `packages/ingestion` (§4); the PDF's
  required "intake-extractor" (handles both `lab_pdf` and `intake_form`). It runs
  extraction and produces a **pending-review draft** — it **does not write and does not
  block the turn**. The write happens later via the **decoupled async review** (§4.4).
  The **answer** is generated from **already-committed** chart facts + retrieved
  evidence; the graph never answers from an un-reviewed document.
- **evidence-retriever worker** — thin wrapper over `packages/rag` (§6). Returns
  reranked guideline snippets with source metadata; **guideline evidence is kept
  separate from patient-record facts** and never merged into one uncited claim.
- **Handoffs = Langfuse child spans** (§9) — every routing decision + worker invocation
  is a traced, inspectable span. A supervisor↔worker **contract test** runs in CI (§8).

## 6. RAG design (`packages/rag`, pure)

**6.1 Corpus.** A small **primary-care guideline** corpus fitting the PCP persona:
**USPSTF** screening recommendations + **CDC** adult immunization schedule (both US-gov
**public domain**) + **ADA Standards of Care** (open-access, ADA-copyrighted — used with
**attribution** for this synthetic/educational demo; **NHLBI/JNC** hypertension guidance
is the public-domain fallback if strict redistribution is ever required). The extracted
**chunks commit to the repo**, so the corpus + index are **reproducible from the repo
alone** (also satisfies the backup requirement, §13).

**6.2 Index (shipped: in-memory).** Chunk by **section with overlap**, retaining
`{doc, section, page}`. Embed each chunk and hold the embeddings in an **in-memory index
in the agent process** (`packages/rag` `buildIndex`). The **embedder is injected**: a
deterministic **bag-of-words** embedder offline/CI (so retrieval + the eval gate run with
no live call), and **Cohere embed v3** in prod (`apps/agent/src/cohere/cohereEmbed.ts`,
enabled when `COHERE_API_KEY` is set). **Postgres/pgvector is a planned/optional scale
enhancement — not deployed today**; the corpus is small enough that the in-memory index
is sufficient, and the index is rebuilt from the committed corpus on boot (so its RPO is
"repo HEAD", §13).

**6.3 Retrieve (hybrid) + rerank.** All of this runs over the in-memory index — pure and
deterministic (`packages/rag/src/retrieve.ts`):
- **Dense**: cosine similarity over the embeddings (meaning). *(pgvector ANN is the
  planned drop-in when the corpus outgrows in-memory.)*
- **Sparse**: exact **query-term overlap** keyword search (drug names, codes, acronyms).
  *(Postgres full-text search is the planned equivalent at scale.)*
- **Fuse** the two candidate lists via **Reciprocal Rank Fusion (RRF)**.
- **Rerank** the fused top-N with **Cohere rerank v3**
  (`apps/agent/src/cohere/cohereRerank.ts`) → **top 3–5** → feed *only* those, with
  source metadata, to the answer model.
- ColQwen2 / multi-vector indexing is **explicitly stretch** (PDF) — not in core.

**6.4 Contract.** `packages/rag` exposes a Zod-contracted `retrieveEvidence(query, index,
embed)` → `EvidenceSnippet[]` with `{doc, section, page, chunk_id, text, score}`. The
store (in-memory today, pgvector later) sits behind this contract, and the embedder is an
injected `EmbedFn` — swapping either does not touch the graph. No LangGraph import.

## 7. Data layer

| Store | Role | Notes |
|---|---|---|
| OpenEMR **MariaDB** | System of record (incl. derived `Observation`s) | Agent **never** connects directly; read via FHIR, write via module. |
| **Redis** (agent-owned) | Patient Snapshot cache (W1, optional) **+** pending-review ingestion drafts (W2) | TTL-based, in-boundary, ioredis; drafts hold PHI transiently and are never logged (§11). |
| **In-memory RAG index** (agent process) | Guideline embeddings + hybrid retrieval | Rebuilt from the committed corpus on boot; no separate container. |
| **Langfuse Postgres** | Langfuse backing store only | Observability ≠ app data; the **only** Postgres in the shipped stack. |

**No agent-owned Postgres/pgvector ships today.** The RAG index is **in-memory** (§6) and
the pending-review drafts live in the agent's **Redis** — so there is no agent database
container beyond Langfuse's own. **pgvector is a planned/optional scale enhancement.**

**Why pgvector *would* be the store at scale (design rationale, for the record):**
(1) **pgvector** is the mature, standard hybrid-RAG store; MariaDB/MySQL vector support is
newer and less proven. (2) The **isolation boundary** requires the agent to own its state
separately — the agent must never touch OpenEMR's operational DB. (3) Postgres is already
operated in the stack (Langfuse), so adding an agent Postgres is a low-friction container.
At the current synthetic-data demo corpus size, none of this is needed yet — the in-memory
index is sufficient and simpler to operate.

**Managed DB — deliberately deferred.** A DO **Managed Database** (auto backups, standby
failover, PITR) is **production-hardening we do not need** at synthetic-data, single-user,
demo scale. The graded **backup/recovery** requirement is met without any agent DB at all:
the corpus + eval golden set are committed to the repo and the index is rebuilt from them
(§13). **Migrate-to-managed trigger conditions** (on record for future): real PHI + uptime
SLAs, unacceptable data-loss risk, or scale beyond a single box that forces the move to
pgvector.

## 8. Eval-driven CI gate (the graded hard gate)

**8.1 Golden set.** Grow the W1 7-case promptfoo suite to **50 cases** (tagged
`week:2`; one unified `evals/` suite) exercising **extraction, evidence retrieval,
citations, refusals, and missing-data behavior**. Synthetic/demo data only;
**reproducible from the repo**.

**8.2 Boolean rubrics only** (no 1–10). Categories (all required):
`schema_valid` · `citation_present` · `factually_consistent` · `safe_refusal` ·
`no_phi_in_logs`. The **safety subset stays 100%**.

**8.3 Gate mechanics.** Build **fails if any category regresses > 5% or drops below its
pass threshold** (PDF Core Req 6). The regression-catching assertions are
**deterministic** (`schema_valid`, `citation_present`, `no_phi_in_logs`) so the grader's
injected regression fails **deterministically**, not flakily. **Caveat on stubbed
categories:** because the VLM/LLM are stubbed in CI (§8.4), `factually_consistent` and
`safe_refusal` gate the **verification pipeline around fixed model outputs**, not live
model-quality drift — they catch code regressions in the gate/graph, not a model getting
worse. The three deterministic categories are the load-bearing ones for the grader's
injected-regression test; model-quality drift is watched separately via Langfuse on live
traffic.

**8.4 CI host (decided — the pre-push git hook is authoritative).** The authoritative,
push-blocking gate is a **local pre-push git hook** running `copilot/scripts/eval-gate.sh`
— **offline, deterministic, full-suite + the golden-set self-test** (`evals/w2/`). It is
**auto-installed** on `pnpm install` in `copilot/` (the root `prepare` script runs
`scripts/install-git-hooks.sh`), so a fresh clone is gated with no extra steps; a non-zero
exit **rejects the push**. The hook runs the **full workspace suite** (`pnpm -r test`) so a
regression *anywhere* (schemas, scorers, tools, verification, ingestion, the agent) blocks
the push, then the **50-case golden set + the prove-the-red self-test**. All of it runs on
**stubbed LLM/VLM/OCR + committed fixtures — no live API keys** (PDF req). The PDF accepts
"Git Hook **or equivalent**"; this is that gate.

**The GitLab CI runner path was considered and dropped.** The original plan (memory
`w2-ci-runner-plan`) was a self-hosted `gitlab-runner` on the DO droplet as the PR-blocking
gate. It was dropped because the droplet is small and **also runs the live demo stack** —
a CI runner there risks starving the demo (droplet contention), and standing up/maintaining
a runner is operational surface the demo does not need. **There is no `.gitlab-ci.yml` in
the repo.** The git hook delivers the same guarantee (block a regression before it reaches
shared history) without the shared-droplet contention. If a dedicated runner is ever
available, a GitLab pipeline can be re-introduced running the identical `eval-gate.sh`.

**8.5 Self-test the hard gate.** Before submission, inject our own regression and confirm
the pipeline goes **red** — the requirement is not "we have a gate," it's "the gate
blocks a regression."

## 9. Observability & cost (W2 extension)

- **Per-encounter signals** (PDF Core Req 7): tool sequence, latency by step, token
  usage, cost estimate, **retrieval hits**, **extraction confidence**, **eval outcome** —
  all **PHI-free**.
- **Distributed tracing:** each **worker invocation is a child span of the supervisor
  span**; extraction + retrieval sub-calls traceable within their worker spans.
- **Correlation ID** propagates into ingestion, worker handoffs, VLM/retrieval calls, and
  FHIR writes — a full W2 trace reconstructable from the correlation ID alone.
- **Structured logs** extended with W2 event types: ingestion start/complete, extraction
  outcome per field, retrieval hit/miss, worker handoff, eval run — searchable by
  case/event/correlation ID; no parallel logging convention.
- **Dashboard** adds: document ingestion count, extraction field-level pass rate,
  retrieval hit rate, worker routing decisions, eval pass/fail per category, retries, and
  decision outcomes. **Queue depth = N/A in v1** (lazy detection, no background worker) —
  the metric appears (labeled N/A) so the panel is complete; it becomes live if eager
  background extraction is added.
- **`/ready`** extended to check **document storage, vector index, reranker API**, and
  returns **degraded** (not binary) if any dependency is down.
- **SLOs + resilience:** **extraction-to-draft-ready** p95 target (proposed < 30s,
  machine time — excludes human review), retrieval p95; **timeouts + retries on all
  outbound VLM/retrieval calls**; circuit-breaker on the reranker.
- **Baselines:** record W2 **CPU / memory / latency / throughput** for ingestion,
  extraction, RAG, and the full multi-agent run, compared to the W1 baselines to catch
  regressions in shared paths.
- **W2 alerts** (each with a documented response): extraction failure rate, RAG
  retrieval latency, **eval-regression > 5% in any category**.
- **Cost/latency report** extended to the W2 flows (ingestion, extraction, RAG,
  multi-agent run) + W2 **baselines** compared to W1 to catch shared-path regressions.

## 10. Verification gate + critic

- **Gate unchanged** and mandatory for every user-facing clinical answer: deterministic
  citation check → LLM grounding judge (sees only cited source) → deterministic
  constraint engine on structured facts. Interaction/duplicate checks run on the
  **reconciled** med list, now including newly-committed extracted labs as ordinary
  structured facts.
- **Critic (decided):** **deterministic gate runs first** — it already rejects
  uncited/ungrounded claims (no LLM needed for that). A **thin LLM critic runs last**,
  scoped only to **"unsafe action suggestion"** detection (semantic — the read-only
  agent must not drift toward "start drug X"). The critic is **veto-only / advisory**:
  it may tighten (warn, bounded-regenerate, withhold) but **never** overrule a
  deterministic block to let something pass. Safety *pass* decisions stay deterministic
  (`verification-gate.md`). The critic touches the **answer path only — never a write**.

## 11. Security / PHI

- **In-boundary by default:** **OCR (in-process `tesseract.js`, self-hosted in the agent)**,
  self-hosted **Langfuse**, and the agent's own **Redis** (pending-review drafts + snapshot
  cache) — all on the droplet. Document images, extracted values, traces, and logs stay
  inside the trust boundary (in-process OCR means the page image never even crosses a
  container boundary; drafts are TTL-bounded in Redis and never serialized to a log).
- **Single documented egress — Cohere** (embed + rerank). The corpus is non-PHI, but a
  physician **query** may carry patient specifics — same concern that drove
  self-hosting Langfuse. **Tradeoff documented; mitigation:** self-host the reranker for
  zero egress if required.
- **CI PHI-detection check:** an automated check verifies traces, logs, eval datasets,
  and cost reports contain **no** patient identifiers, raw document text, or extracted
  clinical values. Scrubbing approach documented; verified in CI.
- **Secrets** (Anthropic, Cohere, HMAC bridge, OAuth key, Langfuse) — env/CI-variables
  only, masked; never committed, never logged, never in an image layer.
- **Synthetic data only.**

## 12. Data model & lineage (PDF engineering req)

| Artifact | Owner (authoritative) | Lineage | Access | Validation |
|---|---|---|---|---|
| **Source document** | OpenEMR (Documents / `DocumentReference`) | uploaded by front desk | provider-scoped (owned pid) via FHIR | file type/size; hash key |
| **Extracted lab Observation** | OpenEMR (FHIR `Observation`) | VLM extract → schema → **physician confirm** → module write; `derivedFrom` source doc | provider-scoped | `lab_pdf` Zod schema; citation required |
| **Intake facts** | OpenEMR records / Observations | same as above | provider-scoped | `intake_form` Zod schema; citation required |
| **Pending-review draft** | **Agent Redis** (transient, TTL-bounded, pre-commit) | VLM/OCR output | agent-internal, correlation-scoped | schema-valid; per-field confidence |
| **Guideline chunk** | **Repo** (committed) → **in-memory** RAG index | curated corpus → chunk → embed | non-PHI, read-only | `{doc,section,page,chunk_id}` present |
| **Derived lab `Observation`** | OpenEMR **`form_observation`** (FHIR-visible) | confirmed value → module write, `derivedFrom` the source document via `ob_documentationof_*` | provider-scoped | citation present unless physician-corrected; idempotent by (doc+code+value) |
| **Citation record** | Attached to each claim | assembled at answer time | same scope as its claim | must resolve to a retrieved row/chunk/box |

**Data authority rule:** one source of truth per type; **no silent overwrites**; schema
changes from W1 carry a **migration note** (see §12.1).

### 12.1 Schema evolution — W1 → W2 (Zod-first, additive, no W1 breakage)

Every schema addition in Week 2 is **additive** and **Zod-first** — new contracts sit
*beside* the Week 1 ones; no Week 1 shape is changed or removed, so a Week 1 chat turn
is byte-for-byte unaffected.

| # | New contract | Where | Evolves how |
|---|---|---|---|
| 1 | **`LabPdfExtraction` / `IntakeFormExtraction`** Zod schemas (VLM output) | `packages/ingestion/src/schemas/*.ts` | The canonical extraction contract — raw VLM output never bypasses it (`w2-document-ingestion-writes`). New doc types add a **new schema file**, never a change to an existing one. |
| 2 | **`Citation` / `BoundingBox`** contract | `packages/ingestion/src/citation.ts` | Attaches a source-locator to each extracted field (tight box / page-approximate / not-found). Additive; W1 chart-tool provenance (`{source_table,row_uuid,fetched_at}`) is unchanged and still used for chart facts. |
| 3 | **`GuidelineChunk` / `EvidenceSnippet`** | `packages/rag/src/contracts.ts` | New evidence-source facts, kept **separate** from patient-record facts (never merged into one uncited claim). |
| 4 | **Supervisor `RouteDecision`** (typed routing) | supervisor node | New graph-state field; the W1 linear state is a subset — old nodes ignore it. |
| 5 | **Derived `Observation` write** → `form_observation` | `oe-module-copilot` `DerivedObservationWriter` | Uses OpenEMR's **existing** `form_observation` table + `ObservationService`; **no OpenEMR schema migration** is introduced (the `ob_documentationof_*` `derivedFrom` columns already exist). Provenance is stamped into the human-readable description because `form_observation` has no structured citation column in v1 — a documented limitation, not a schema change. |

**Migration posture:** because the additions are new Zod schemas + new graph-state fields
+ a write into an existing OpenEMR table, there is **no destructive migration** and **no
data backfill**. The only forward-compat note is item #5's description-embedded provenance:
if a structured citation column is later added to `form_observation`, the writer moves the
provenance string into it — an additive column, not a rewrite.

## 13. Backup & recovery (PDF engineering req)

**The agent holds no durable state that needs backing up** — this is a deliberate
consequence of the in-memory RAG index + Redis-only drafts (§7). Everything the agent
depends on is either committed to the repo or lives in OpenEMR:

- **Guideline corpus chunks + eval golden set + guideline golden set** are **committed to
  the repo** → reproducible from the repo alone (no DB-only state). The **RAG index is
  rebuilt from the committed corpus on boot** — nothing to back up, nothing to restore.
- **Pending-review drafts** live only in the agent's **Redis** (TTL-bounded, transient,
  pre-commit) — intentionally **not** backed up; loss just means re-running extraction on
  the still-present source `DocumentReference` (no chart data lost).
- **Derived FHIR records** (the one write) live in OpenEMR's **`form_observation`** →
  covered by **OpenEMR's own MariaDB backup**; the agent adds no backup responsibility.
- **RPO/RTO estimates (v1, synthetic-data demo):**
  - *Guideline/eval golden set + corpus chunks* — **RPO 0** (in git; loss = repo HEAD,
    which is authoritative); **RTO minutes** (re-clone + rebuild the index from the
    committed corpus).
  - *RAG index* — derived, not stored → effective **RPO = repo HEAD**; **RTO ~seconds**
    (re-embed the corpus on the next boot; no dump to restore).
  - *Pending-review drafts (Redis)* — transient/pre-commit; **RPO best-effort** (loss just
    means re-run extraction on the still-present source document — no chart data lost).
  - *Derived FHIR records* — RPO/RTO inherit OpenEMR's MariaDB backup policy.

**No `pg_dump` procedure is required for the agent** because it owns no durable database.
If pgvector is later adopted (§7), the index remains rebuildable from the committed corpus,
so its RPO stays "repo HEAD" and a `pg_dump` would be a convenience, not a correctness
requirement.

## 14. Deployment

Extend the DO Compose stack (blue/green Site A / Site B, deploy from `main`) — **with no
new infrastructure containers**. Week 2 adds **no** Postgres/pgvector container (RAG is
in-memory, §6), reuses the **existing agent Redis** for pending-review drafts (§7), and
runs **OCR in-process** (`tesseract.js` WASM inside the agent, decision
`copilot/docs/decisions/w2-ocr-engine.md`) — **no OCR container** to add, deploy to both
sites, or `/ready`-probe. The only deploy-time changes are **env + OAuth scopes**: the
**Cohere key** (`COHERE_API_KEY`) and **VLM model** (`COPILOT_VLM_MODEL`) on the agent,
plus the W2 read scopes on the OAuth client (`DocumentReference.read`, `Binary.read`).
**No gitlab-runner is registered** — the eval gate is the local pre-push git hook (§8.4),
so CI adds nothing to the droplet. Same infra MVP→final; ask before every deploy.

## 15. API surface + OpenAPI 3.0

New W2 HTTP endpoints (all typed, Zod-contracted, correlation-ID-carrying):
`POST /documents/ingest` (or `attach_and_extract`), `GET /documents/pending?pid`,
`GET /documents/:id/extraction`, `POST /documents/:id/confirm`,
`POST /evidence/retrieve`, plus the extended `/chat`. An **OpenAPI 3.0 spec is published
and committed**, kept in sync, and **contract tests verify implementation matches spec**.
The **Postman/Bruno collection** is updated with all W2 endpoints so a grader can run any
W2 workflow.

## 16. Testing strategy (PDF engineering req — every test names its failure mode)

- **Unit (Vitest, pure packages):** Zod schema validators (guards: VLM emits an
  out-of-contract field / wrong type); `packages/ingestion` box-matching (guards: value
  mislocated / hallucinated value not on page); `packages/rag` chunking + RRF fusion +
  rerank ordering (guards: keyword-only hit missed / dense-only hit missed / rerank not
  applied); supervisor decision reducer (guards: invalid routing state).
- **Integration (fixtures + stubs, CI-portable):** full **ingest→answer** path with
  **stored fixture PDFs/form images + stubbed LLM/VLM** (guards: pipeline break across
  the ingestion→extraction→review→write→answer seam; **must pass in CI without live
  API**); supervisor↔worker **contract test** (guards: handoff schema drift);
  FHIR round-trip idempotency (guards: duplicate/untraceable records on re-ingest).
- **Eval golden set (promptfoo, 50 cases):** agent behavior — extraction, evidence
  retrieval, citations, refusals, missing-data (guards: behavioral regressions; the hard
  gate).
- **Not tested (and why):** live third-party model *quality* (Claude/Cohere internals —
  out of our control; we test our contract around them, and stub them in CI); real-scan
  OCR accuracy beyond fixtures (documented as an accepted risk mitigated by the
  human-in-the-loop review and the three-way box outcome).

## 17. W2 failure modes & incident response (PDF engineering req)

| Failure | How to spot (logs/dashboard) | Recovery action |
|---|---|---|
| **Document ingestion failure** (unreadable file, VLM error) | `ingestion.error` event; extraction failure-rate alert | surface "couldn't read this document" to the physician; retry with backoff; leave doc pending (no partial write) |
| **Extraction schema violation** (VLM out-of-contract) | `schema_invalid` in the eval/`schema_valid` metric; log event | bounded retry with schema feedback; degrade — flag offending fields, never bypass the schema |
| **Value-not-on-page** (possible hallucination) | field flagged `unverified` in review; low box-match confidence | forced to top of physician review; not committed until confirmed/edited |
| **RAG returns no results** | retrieval hit-rate = 0; `retrieval.miss` event | answer "no supporting guideline evidence found" (absence ≠ negative); never fabricate evidence |
| **Reranker (Cohere) down/slow** | `/ready` degraded; RAG-latency alert; circuit-breaker open | fall back to fused pre-rerank top-k with a "unreranked" label, or degrade the evidence path; timeouts prevent a hung turn |
| **Supervisor routing error** (invalid decision) | `supervisor.decision_invalid`; span shows no valid route | reject the malformed decision, default to safety-core-only answer + "couldn't route to extraction/evidence" |
| **Evidence retrieval unavailable** (embedder/index error; Cohere embed down in prod) | `/ready` degraded; retrieval error event | evidence path degrades; chart answers still work; alert; the in-memory index rebuilds from the committed corpus on restart (no DB to recover) |
| **PHI leak risk** in a trace/log | CI PHI-detection check red | block the change; scrub; the check is a hard gate |

## 18. Risks & tradeoffs (summary — full list in `copilot/docs/w2-PRD.md`)

- **VLM hallucination** → schema gate + three-way box cross-check + human-in-the-loop
  confirm + extraction regression cases.
- **Gate doesn't block the grader's regression** → deterministic assertions + self-test
  the red before submission.
- **Supervisor black box** → typed decision + rationale + child spans + contract test.
- **Cohere query egress** → documented tradeoff; self-hostable reranker fallback.
- **Latency of VLM+RAG+multi-agent** → supervisor routes (optional workers only when
  needed); ingestion off the chat fast-path; timeouts/retries; measure before locking
  the SLO.
- **Runner starves the live droplet** → concurrency limits / isolate; local-hook
  fallback.
- **Scope creep** → "narrower is stronger": two document types reliable before anything
  else; third type + lab-trend widget + retrieval tuning are stretch only.

## 19. Open questions

- W2 latency SLO numbers — confirm against a first real run.
- Demo-scenario anchor patient + the exact synthetic lab-PDF/intake fixtures (synthetic,
  repo-reproducible) — decide in the seed/eval spec.
- Guideline corpus versioning cadence (how the committed chunks are refreshed).
- Exact FHIR representation for intake facts (Observation vs. other resources) — confirm
  in the ingestion spec.
- ~~gitlab-runner on the droplet vs. fallback~~ — **resolved:** the GitLab runner was
  dropped for droplet contention; the pre-push git hook is the authoritative gate (§8.4).
- pgvector migration trigger — when the corpus outgrows the in-memory index (§7); not
  needed at current demo scale.
