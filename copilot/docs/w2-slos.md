# SLOs, timeouts & performance — Clinical Co-Pilot (W2)

Grounded in the measured load test (`loadtest/results-2026-07-15-siteB/loadtest-comparison.md`, Site B,
2026-07-15) and the deployed configuration. Numbers are for the full grounded path (generate + grounding
judge on), driven over the public internet.

## Service-level objectives

| SLO | Target | Measured (10 concurrent, post-fix) | Status |
|---|---|---|---|
| Chart-Q&A latency **p50** | < 6 s | 5.7 s | ✅ |
| Chart-Q&A latency **p95** | < 10 s | 7.6 s | ✅ |
| Error rate at expected load (≤ ~10 concurrent physicians) | 0% | 0% (100/100) | ✅ |
| Sustained throughput | ≥ 1.5 req/s | 1.72 req/s | ✅ |
| Availability of a *grounded or honestly-degraded* answer | 100% (never a silent/empty answer) | held | ✅ |

The **p95 < 10 s** target reflects Dr Lee's "seconds, or I won't use it" bar for the between-rooms window.
Routing the supervisor on Haiku (not the generation model) was the change that brought p95 from 45 s to
7.6 s — see the load-test comparison.

## Timeouts (all env-configurable)
- **OpenEMR readiness probe:** `OPENEMR_PROBE_TIMEOUT_MS` = 8 s — a slow chart backend marks `/ready` not-ready.
- **Per-request load budget:** the driver caps a request at `REQ_TIMEOUT_MS` (default 120 s); real clients
  stream SSE and see partial answers immediately.
- **Anthropic / Cohere calls:** SDK defaults; failures **degrade**, they do not hang the turn (below).

## Graceful degradation (never a hard failure or silent drop)
- **Cohere rerank down →** fall back to the RRF-fused order (`rerankEvidence` returns `reranked:false`);
  the answer still returns, flagged in metrics as `rerank:degraded`.
- **A non-critical dependency down (Cohere/RAG) →** `/ready` reports **`degraded`** (HTTP 200), chart Q&A
  keeps working; only a critical dep (redis/openemr/anthropic) yields `not_ready` (503).
- **Grounding judge drops a claim →** bounded regenerate-with-feedback, then a labeled partial answer
  ("here's what I can confirm; I could not verify X") — never the unverified statement.
- **A chart tool errors →** typed + surfaced to the graph; the turn answers with what it has, never crashes.

## Known ceiling + the fix that raises it
At **~50 concurrent** the agent saturates OpenEMR: each chat fans out to ~5 FHIR reads, so ~50 chats ≈
~250 concurrent FHIR calls, and OpenEMR returns `OpenEmrFhirError`s (the 2026-07-10 baseline and the
2026-07-15 run both hit this wall). Haiku routing does **not** change the FHIR call count, so the 50c
ceiling stands. The architecture's **cached Patient Snapshot** (read once, serve many) is the documented
mitigation that attacks the 5× amplification directly and moves the ceiling out — highest-leverage next
perf item. A **circuit-breaker on the Cohere reranker** is **implemented** (`apps/agent/src/cohere/circuitBreaker.ts`,
wired in `wire.ts`): after 3 consecutive rerank failures it opens for a 30s cooldown and fails fast, so
retrieval degrades to the fused order immediately instead of paying a per-request timeout to a down/rate-
limited service — meaningful now that RAG runs against a rate-limited trial key. `rerankEvidence`'s existing
try/catch turns the open-circuit error into the fused fallback, so behaviour is unchanged beyond faster degrade.

## Cost
Model tiering keeps per-turn cost low: **generation** on Sonnet, **routing + grounding** on Haiku.
Measured ≈ **$0.008–0.02 per turn** grounding-on (agent `chat completed` usage logs). Observability is
self-hosted (Langfuse) so no PHI-bearing traces leave the trust boundary and there is no per-trace SaaS cost.
