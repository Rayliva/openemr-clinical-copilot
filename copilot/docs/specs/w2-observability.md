# Spec: Week-2 observability cluster

Grounds `../../W2_ARCHITECTURE.md §9`. Week 2 adds real operational signals for the three new
surfaces — document ingestion, guideline RAG, and the supervisor/worker graph — recorded from the
real code paths, surfaced on `/metrics` + `/dashboard`, alerted, logged, and traced. This spec is the
source of truth; the code is downstream of it.

This file also serves as the **W2 structured-log event vocabulary** (requirement #3) — the named
pino events at the bottom.

Carries **no PHI**: counts, latencies, doc types, and match states only — never a pid, a document
title, a patient value, or a correlation id in the metrics/dashboard surface (`phi-and-secrets`,
`error-handling-and-logging`). The correlation id appears **only** in structured logs and traces
(in-boundary), never in the metrics snapshot.

## 1. W2 metrics (behavior)

Extend `@copilot/metrics` with three W2 sub-snapshots, each recorded from a real code path. Counters
are monotonic; latencies are bounded-window percentiles (same `Window` as W1).

### 1.1 Ingestion (`snapshot.ingestion`)
Recorded in `apps/agent/src/ingestion/ingestionService.ts` (`runDetectAndIngest`) — once per document
actually extracted (a cache hit records nothing; extract-once holds).

- `documentsTotal` — documents ingested.
- `byDocType[docType]` — `{ total, ok, degraded }` per `lab_pdf` / `intake_form` / `unknown`.
- `extractionOk` / `extractionDegraded` — extraction outcome tally.
- `fieldsLocated` / `fieldsForcedReview` — per-field box-match outcome (`located` vs
  `approximate`+`unverified`), the located-vs-forced-review rate.
- `extractionLatencyMs` — p50/p95 of the per-document extract-to-draft duration (machine time; the
  W2 SLO in §9).

**AC:** an `ok` lab draft with 3 located + 1 unverified result records `documentsTotal+1`,
`byDocType.lab_pdf.ok+1`, `fieldsLocated+3`, `fieldsForcedReview+1`, and one latency sample. A
`degraded` draft records `extractionDegraded+1` and **no** field samples.

### 1.2 Retrieval (`snapshot.retrieval`)
Recorded in the evidence-retriever closure in `apps/agent/src/agent/wire.ts` — once per retrieval
query (the latest user question).

- `queriesTotal` — retrieval queries run.
- `snippetsTotal` — sum of snippets returned (hits).
- `zeroHitQueries` — queries that returned nothing (`retrieval.miss`; absence, never a negative
  finding).
- `rerankUsed` / `rerankDegraded` — rerank succeeded vs fell back to the fused pre-rerank top-N
  ("unreranked", the documented runbook fallback).
- `latencyMs` — p50/p95 of the retrieve+rerank round-trip.

**AC:** a query returning 3 reranked snippets records `queriesTotal+1`, `snippetsTotal+3`,
`rerankUsed+1`, one latency sample; a rerank transport failure records `rerankDegraded+1` and still
returns the fused top-N (never an empty answer, never a thrown turn).

### 1.3 Supervisor (`snapshot.supervisor`)
Recorded in the supervisor node in `apps/agent/src/graph/graph.ts` — once per supervisor hop.

- `routes[target]` — count of routing decisions per next-target (`intake_extractor` /
  `evidence_retriever` / `ready`).
- `turnsRouted` — turns that reached a terminal (`ready`) decision through the supervisor.
- `hopCapHits` — times the hop cap forced `ready` (the loop backstop fired).

**AC:** a turn routed `intake_extractor` → `ready` records `routes.intake_extractor+1`,
`routes.ready+1`, `turnsRouted+1`, `hopCapHits+0`.

## 2. W2 alert rules

Add to `packages/metrics/src/alerts.ts` (each mirrored in `docs/oncall.md`). Same
`classify(value, warning, critical)` + volume-gate shape as W1. Below the volume gate →
`insufficient_data` (does not fire).

- `extraction_failure_rate` — `extractionDegraded / (ok+degraded)`. warning 0.2, critical 0.5. Gate:
  ≥ 5 extractions.
- `rag_retrieval_latency_p95` — `retrieval.latencyMs.p95` (ms). warning 4000, critical 8000.
- `supervisor_hop_cap_rate` — `hopCapHits / turnsRouted`. warning 0.2, critical 0.5. Gate:
  ≥ 10 routed turns. (Optional-but-included: a rising hop-cap rate means the router loops.)

**AC:** a healthy snapshot (W2 traffic present, no failures) returns every W2 rule `ok`; nothing
fires. A snapshot with `extractionDegraded=6, extractionOk=0` fires `extraction_failure_rate`
critical.

## 3. Surfacing
Both the machine `GET /metrics` (the raw snapshot, already whole-object) and the `/dashboard` HTML
gain W2 sections: Ingestion, Retrieval, Supervisor. PHI-free. The dashboard shows document count,
located-vs-forced-review rate, extraction p50/p95, retrieval hit stats, rerank used/degraded,
retrieval p50/p95, and routing decision counts. `Queue depth = N/A` label per §9.

## 4. `/ready` degraded status
`ReadinessRegistry` gains a per-check `critical` flag (default `true`). The report status is:
- `not_ready` (HTTP 503) — any **critical** check failed.
- `degraded` (HTTP 200) — all critical checks ok, but a **non-critical** check failed.
- `ready` (HTTP 200) — all checks ok.

The Cohere/RAG-index dependency registers **non-critical**: RAG down → `degraded`, chart answers keep
working. Redis/OpenEMR/Langfuse/Anthropic stay critical (unchanged).

**AC:** empty registry → `ready`. A failing non-critical check → `degraded`, 200. A failing critical
check → `not_ready`, 503. Existing `{name,status}` check-result shape is unchanged (no leak).

## 5. Child-span nesting
Worker spans (`worker:intake_extractor`, `worker:evidence_retriever`) are **children of the
supervisor span**, not siblings under the trace root (§9: "each worker invocation is a child span of
the supervisor span"). The supervisor span spans the whole routing cycle; each hop's decision and each
worker invocation nests under it. The correlation id already flows via the request-scoped tracer.

**AC:** a test tracer records parent→child edges; `worker:evidence_retriever` and
`worker:intake_extractor` resolve to a parent named `supervisor`.

## 6. W2 structured-log event vocabulary (requirement #3)
Named pino events, object-context only (no string interpolation), every one carrying `correlationId`.
No PHI (no titles, no values) — counts, types, states.

| Event | Where | Context fields (all PHI-free) |
|---|---|---|
| `ingestion.complete` | `runDetectAndIngest` | `correlationId, documents, ok, degraded` |
| `extraction.field` | `runDetectAndIngest` (per doc) | `correlationId, docType, located, forcedReview` |
| `retrieval.hit` | evidence-retriever (wire.ts) | `correlationId, snippets, rerank` |
| `retrieval.miss` | evidence-retriever (wire.ts) | `correlationId, snippets: 0` |
| `worker.handoff` | supervisor node (graph.ts) | `correlationId, target, hops` |

`correlationId` is threaded into the ingestion service + the graph node state so each event can carry
it; it is **never** placed in the metrics snapshot.

## 7. Per-encounter completeness (requirement #5 — added 2026-07-17)

The PDF requires each encounter to log seven signals; two were thin. This closes both.

### 7.1 Numeric extraction confidence
`extraction.field` (and `recordIngestion`) previously logged only the located-vs-forced-review split
(a box-match proxy). It now also carries the **numeric model confidence** aggregated per document from
each result's `confidence` (0–1): `confidenceMin` + `confidenceMean` (2-dp), plus `fields` (count).
`null`/omitted when the draft is degraded (no results). PHI-free — a confidence number, no value/title.
Pure helper `draftConfidence(draft)` (unit-tested).

### 7.2 Per-encounter eval outcome
Each chat turn logs an `evalOutcome` object — the **deterministic** boolean rubric categories evaluated
on THIS turn (not the CI golden set):

| category | live meaning | source |
|---|---|---|
| `schema_valid` | generation produced structurally valid claims (no generation failure) | `generationOk` state |
| `citation_present` | every surfaced claim resolves to a retrieved row | `checkCitations` (same as the gate) |
| `grounding_ok` | the grounding judge dropped nothing this turn | `ungrounded.length === 0` |
| `no_phi_in_logs` | invariant: structured logging, no PHI interpolation | `true` by construction (CI-enforced) |

`factually_consistent` + `safe_refusal` need a golden expectation → they stay **CI-only** (documented
here, not logged live). Pure `evaluateEncounter(...)` reuses `@copilot/verification.checkCitations`.
Added to the `chat completed` log + the trace `end` payload; PHI-free (booleans only). New graph state
channel `generationOk` (default `true`, set `false` in the `generate` catch).

Log-event vocabulary additions:

| Event | Where | Context fields (all PHI-free) |
|---|---|---|
| `extraction.field` (extended) | `runDetectAndIngest` (per doc) | `+ confidenceMin, confidenceMean, fields` |
| `chat completed` (extended) | `/chat` | `+ evalOutcome{schema_valid,citation_present,grounding_ok,no_phi_in_logs}` |

## Boundaries / non-goals
- `evalOutcome` is the deterministic subset only; the full 5-category rubric (incl. the two needing a
  golden expected answer) runs in the CI eval gate, not per live encounter.
- No new external observability service (Langfuse stays the only tracer; `phi-and-secrets`).
- The metrics registry stays in-process and non-durable by design (Langfuse holds history).
- No queue-depth metric is implemented (lazy detection; labeled N/A per §9).
- Sub-call spans inside pure `@copilot/rag` / `@copilot/ingestion` packages are out of scope — those
  packages never import the tracer (`orchestrator-only`); nesting is done at the graph/wire edge.
