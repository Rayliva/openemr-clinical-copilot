# Cost & latency — FINAL (2026-07-19, Site B, commit `a0837c0`)

Refresh of the 2026-07-15 report for the final-submission build. **This build runs the full graded
W2 config: RAG/Cohere ON, supervisor + 2 workers ON, grounding judge ON.** (The 07-15 numbers were
measured with Cohere/RAG OFF, so they are not directly comparable — this is the honest current state.)

## Latency (measured against deployed Site B `https://copilot.159-203-80-102.sslip.io`)

| Level | Success | Error rate | p50 | p95 | p99 | Throughput |
|---|---|---|---|---|---|---|
| **1 concurrent** (single physician — the real UX) | 16/16 | **0%** | **840 ms** | **1,355 ms** | 1,355 ms | 1.1 req/s |
| **10 concurrent** (run A) | 100/100 | **0%** | 8,830 ms | 28,187 ms | 31,249 ms | 0.80 req/s |
| **10 concurrent** (run B, repeat) | 100/100 | **0%** | 8,404 ms | 28,621 ms | 30,820 ms | 0.76 req/s |
| **50 concurrent** | — | severe (OpenEMR FHIR wall) | — | — | — | *characterized from logs — see 07-15 report §50c* |

Driver: `loadtest/run.mjs` from a host over the public internet (network latency is a constant, not a
differential). 4 Dr-Lee-owned patients rotated; 4-question chart mix (who / meds / allergies /
anything-else) — none trigger the write- or cross-patient short-circuits, so these are full-path turns.

## The one-line finding: latency is **concurrency-bound on the single Anthropic key**, not code

- **Single request is fast: ~0.84 s p50, ~1.4 s p95.** This is what the physician (and the demo) actually
  experiences — one turn at a time.
- **At 10 concurrent, p50 jumps ~10× (0.84 s → 8.4 s).** That 10× is almost entirely **queueing on one
  shared Anthropic API key**: each turn makes **2–3 sequential model calls** (supervisor routing on
  Haiku → generation on Sonnet → grounding judge on Haiku per claim), so 10 concurrent turns put
  ~25–30 calls in flight against a single key and they serialize on its rate limit. **0% errors** — the
  circuit breaker + bounded degrade keep every request returning a full grounded answer; the cost is
  latency, not failures.
- **At 50 concurrent, the wall is OpenEMR** — the audit's ~5× FHIR read amplification (~50 chats ≈ ~250
  concurrent FHIR reads) saturates OpenEMR CPU (measured 88.7% at only 10c, `docker-stats-during-load.txt`).
  This is the pre-existing baseline wall, unchanged by the agent.

## Bottleneck, by load regime
1. **Low / single-user:** none — sub-1.5 s, the demo experience.
2. **Concurrent (10c):** the **single Anthropic key** (2–3 sequential LLM calls/turn × N turns). Fixes:
   a per-key concurrency limiter / request shaping, multiple keys / higher tier, or fewer calls/turn
   (short-circuit obvious chart-only turns past the supervisor — already cheap on Haiku).
3. **High (50c):** **OpenEMR FHIR read-amplification** (CPU-bound). Fix: the Redis-cached Patient
   Snapshot (already in the architecture) collapses the ~5× read fan-out.

## Cost (see `docs/cost-analysis.md` for the full measured analysis + projections)
- **Actual dev spend (metered, Langfuse):** Site B's self-hosted Langfuse shows **$2.70 across 577 traces**
  over the 5-day W2 build window (input 526K / output 75K tokens), on top of the earlier $0.53 snapshot —
  i.e. the whole project's traced LLM spend is **single-digit dollars**. The workload is inherently
  low-token (read-only, minimum-necessary prompts) and evals are deterministic (grader-LLM $0).
- **Cost per turn (measured):** ~$0.005–0.007 std pricing (`claude-sonnet-5` generate; Haiku for
  routing + grounding). Output tokens drive the spread.
- **Projected production cost:** see `cost-analysis.md §6` — banded across turns/provider/day × scale
  (e.g. mid ≈ ~$3.9K/yr @100 providers … ~$2.9M/yr @100K), movable ~25–45% by schema-trim + tiering +
  caching. A per-API-key throughput ceiling (~300 turns/min) is the real non-linear wall before cost is.

## Infra (CPU/mem at 10c, unchanged from 07-15) — OpenEMR is the CPU bottleneck
openemr ~89% CPU / 260 MiB · langfuse 78% / 155 MiB · agent 45% / 167 MiB · mysql 7% · redis <1%. The
agent is light and stateless; headroom is on the OpenEMR/chart side (the Snapshot cache addresses it).
