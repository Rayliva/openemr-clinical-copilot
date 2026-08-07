# Load / stress test — deployed Clinical Co-Pilot agent

Traces to the **Load/stress test** + **Baseline CPU/mem/latency/throughput** engineering
requirements. Run with `loadtest/run.mjs` against the **live prod agent**
(`https://copilot.203-0-113-10.sslip.io/chat`), grounding judge **on** (prod config:
Sonnet generation + Haiku grounding per claim). Tokens were minted with the prod bridge
secret (dev-mint is off in prod) for 7 real Donna-owned patients, rotating a realistic
question mix (demographics / meds / allergies / "anything else before the visit").

- **Date:** 2026-07-10. **Levels:** 10 and 50 concurrent, 100 requests each (+3 warmup).
- **Latency percentiles are over *successful* requests**; failures are captured as error rate.

## Headline results

| Level | Success | Error rate | p50 | p95 | p99 | max | Throughput |
|---|---|---|---|---|---|---|---|
| **10 concurrent** | 100/100 | **0%** | 5,969 ms | 10,166 ms | 12,267 ms | 14,993 ms | 1.37 req/s |
| **50 concurrent** | 27/100 | **73%** | 19,914 ms | 31,666 ms | 33,976 ms | 33,976 ms | 2.17 req/s |

At **10 concurrent the agent is stable** — zero errors, every request returns a full
grounded answer, p95 ~10 s (grounding-on latency; see below). At **50 concurrent it falls
over**: 73% of requests fail and the survivors run 20–34 s.

## Baseline infrastructure metrics (sampled on the droplet *during* the run)

Single DigitalOcean VM, also hosting MariaDB, Redis, Langfuse, and Caddy. 96 `docker stats`
samples (raw: `docker-stats-during-load.txt`).

| Container | CPU % peak | CPU % mean | Mem MB peak | Mem MB mean |
|---|---|---|---|---|
| `deploy-agent-1` (Node/Fastify agent) | 46.5 | 10.4 | 230 | 198 |
| `deploy-openemr-1` (PHP/Apache + FHIR) | **115.5** (>1 core) | 37.6 | 763 | 514 |

**The agent is not the bottleneck** — it sits mostly idle waiting on I/O (CPU peak 46%,
~200 MB RAM). **OpenEMR is** — it peaks past a full core serving the FHIR reads. Neither is
memory-bound.

## Root cause of the 50-concurrent cliff (from agent logs)

Every one of the 73 failures was **HTTP 500 = `OpenEmrFhirError` ("fhir request failed with
status 500")** — **not** an LLM/Anthropic rate limit. The mechanism:

1. The agent assembles context by fanning out **5 FHIR reads per `/chat`** (demographics,
   problems, meds, allergies, immunizations) in a `Promise.all`.
2. So **50 concurrent chats ≈ 250 concurrent FHIR calls**, which saturates OpenEMR's
   PHP/Apache/MariaDB layer → OpenEMR starts returning 500s.
3. Two amplifiers make it worse than it needs to be:
   - **No Patient Snapshot cache yet** (`ARCHITECTURE.md §3`): every turn re-reads all five
     resources from OpenEMR instead of a cached snapshot. This is the audit's
     "every read is audit-amplified" finding showing up under load.
   - **No per-tool isolation:** a single FHIR 500 rejects the whole `Promise.all`, so one
     slow/failed resource fails the entire request rather than degrading to a partial,
     labeled answer (a gap against our own error-handling / graceful-degradation rule).

## What this means / next actions (ranked)

1. **Wire the Redis Patient Snapshot cache** (already in the architecture, not yet built).
   Collapsing 5 FHIR reads/turn → 1 cached snapshot is the single highest-leverage fix; it
   attacks the 5× amplification directly and would move the 50-concurrent wall out
   substantially.
2. **Isolate tool failures** in `assembleContext` — use `Promise.allSettled` and degrade to a
   partial, provenance-labeled answer when a resource errors, instead of 500-ing the request.
3. **Scale OpenEMR before the agent.** The agent is light; OpenEMR/MariaDB is the constraint.
   Horizontal OpenEMR/PHP workers + a read path that isn't per-turn-amplified is the scaling
   story for a 300-concurrent-clinician hospital.
4. **Latency is grounding-dominated even when healthy** (p95 ~10 s at 10c). For latency-
   sensitive turns, tier simple lookups off the grounding path or cache the snapshot so the
   only cost is the LLM.

## Honest limitations

- One run per level (cost-bounded, ~$2 Anthropic). p99 at 50c is effectively the worst of 27
  survivors — directional, not tight.
- Percentiles exclude failed requests by design; the 50c row must be read together with its
  73% error rate, not as a latency-only number.
- Load was driven from a single host over the public internet; absolute latency includes
  network + Caddy TLS, which is what a real client sees.
