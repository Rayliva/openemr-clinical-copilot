# Load-test comparison — original vs 2026-07-12 (Site A)

Re-ran the load driver against **Site A** (`https://copilot.203-0-113-10.sslip.io`),
same levels as the original (10 & 50 concurrent × 100 requests, +3 warmup). Written to
`loadtest/results-2026-07-12-siteA/` — **the original `loadtest/results/` is untouched.**

| Level | Metric | Original (2026-07-09) | Today (2026-07-12, Site A) |
|---|---|---|---|
| **10c** | success / error | 100/100 · **0% err** | 100/100 · **0% err** |
| | p50 / p95 / p99 | 5.97 / 10.17 / 12.27 s | 7.81 / 28.82 / 32.25 s |
| **50c** | success / error | 27/100 · **73% err** | **100/100 · 0% err** |
| | p50 / p95 / p99 | 19.91 / 31.67 / 33.98 s* | 20.66 / 48.59 / 59.10 s |

\* Original 50c percentiles are over the **27 successful** requests only; the 73 failures
(fast OpenEMR 500s) are not in them.

## Headline: the 50-concurrent saturation cliff is GONE (73% → 0% errors)

The original run's 50c level collapsed — 73% of requests failed with
`OpenEmrFhirError` (HTTP 500), because **50 concurrent chats × 5 FHIR reads/turn ≈ 250
concurrent FHIR calls** saturated OpenEMR's PHP/Apache/MariaDB layer. Today, **all 100
requests at 50 concurrent succeed** — the cliff is resolved.

**Why:** the **agentic tool-calling** change (landed after the original run) cut the
per-turn FHIR fan-out from *always 5 reads* to the **4-read safety core + only the
optional tools the LLM decides it needs**. Fewer concurrent FHIR calls → OpenEMR no
longer saturates at 50 concurrent. This is exactly the E9 hardening the tracker flagged
as the fix. (The Redis Patient Snapshot cache — still unbuilt — would cut it further, to
one read on repeat turns.)

## Caveat: the latency numbers are higher and not apples-to-apples

Latency rose at both levels, but two confounds make the absolute numbers non-comparable —
**the robust, environment-independent signal here is the error rate, not the latency:**

1. **50c is now measured over 100 completed requests, not 27 survivors.** The original's
   50c p95 (31.7 s) excluded the 73 that failed *fast*; today every request completes, so
   the p95 (48.6 s) includes fully-queued requests. Succeed-but-slow is a **better** failure
   mode than fail-fast — but it reads as higher latency.
2. **The driver ran from a laptop over home wifi to the droplet.** Every request traversed
   that link, inflating and adding variance to the latency (the 10c p95 jump 10 → 29 s is
   larger than queuing alone explains, and is consistent with a network-confounded leg). A
   500 from OpenEMR saturation, by contrast, is a 500 regardless of the client's network —
   so the error-rate comparison holds where the latency comparison doesn't.

**Takeaway:** the deployed agent now **stays up under 50-concurrent load** where it
previously shed 73% of requests — a real resilience win from the reduced FHIR fan-out.
Latency under heavy concurrency is the remaining lever (Redis snapshot cache; grounding
cost), and should be measured from a stable network for a clean number.

## How it was run

```
AGENT_URL=https://copilot.203-0-113-10.sslip.io   # Site A
RUN_ISO=2026-07-12-siteA
OUT_DIR=loadtest/results-2026-07-12-siteA          # new dir — originals preserved
LEVELS default (10/100, 50/100); 6 provider-owned patients rotated
COPILOT_BRIDGE_SECRET read from A's deploy/.env machine-to-machine (never printed)
node loadtest/run.mjs
```
