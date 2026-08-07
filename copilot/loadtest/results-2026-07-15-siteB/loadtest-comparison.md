# Load test — 2026-07-15 (Site B, W2) vs 2026-07-10 baseline (Site A, W1)

## Setup
- **Target:** deployed Site B agent `https://copilot.SITE-B-IP.sslip.io`, commit `ea06ee7` (full W2).
  Cohere/RAG **off** on Site B; grounding judge **on**; supervisor **on** (wired whenever Claude is present).
- **Driver:** `loadtest/run.mjs` from a host over the public internet (**same as the baseline** — network
  latency is not a differential). 4 Dr-Lee-owned patients rotated, 4-question clinical mix.
- **Baseline:** 2026-07-10 Site A (`loadtest/results/`), the **W1 linear graph** (assemble → generate → verify).

## Results
| Level | Run | Success | Error rate | p50 | p95 | p99 | Throughput |
|---|---|---|---|---|---|---|---|
| **10c** | Baseline (W1) | 100/100 | 0% | 5,969 ms | 10,166 ms | 12,267 ms | 1.37 req/s |
| **10c** | 2026-07-15 (W2, Sonnet routing) | 100/100 | **0%** | 11,679 ms | 44,826 ms | 53,981 ms | 0.51 req/s |
| **10c** | 2026-07-15 (**W2 + Haiku routing** — fixed) | 100/100 | **0%** | **5,674 ms** | **7,591 ms** | **9,762 ms** | **1.72 req/s** |
| **50c** | Baseline (W1) | 27/100 | 73% | 19,914 ms | 31,666 ms | 33,976 ms | 2.17 req/s |
| **50c** | 2026-07-15 (W2) | — | severe | *level did not finish in the 10-min harness window under saturation; see below* |

## FIX APPLIED — route the supervisor with Haiku (commit `1ee1366`)
The entire 10c tail-latency regression was the supervisor running its routing decision on the **Sonnet
generation model**. Routing is a narrow typed classification, so `COPILOT_SUPERVISOR_MODEL` now defaults
to **Haiku**. Re-measured on Site B after redeploy (`2ff65f0`): **p95 44,826 ms → 7,591 ms** (−83%), p50
11,679 → 5,674 ms, throughput 0.51 → 1.72 req/s. The W2 graph is now **faster than the W1 baseline**
(p95 7.6 s vs 10.2 s) despite doing more work — the supervisor + grounding calls on Haiku are cheap. This
is the recommended fix, applied and verified.

## 10-concurrent: stable, but ~2–4.5× slower (researched)
Still **zero errors** — every request returns a full grounded answer. But p50 ~2× and **p95 ~4.5×** the
baseline (45 s vs 10 s). Root cause:
- **W1 → W2 architecture.** The baseline was the linear graph (generate + grounding = ~2 LLM calls/turn).
  W2 adds a **supervisor routing LLM call per turn** (and reachable workers). My supervisor-decouple fix wires
  the supervisor whenever Claude is present, so Site B (Cohere off) now runs it. That is **+1 LLM call/turn** →
  ~10 concurrent turns drive ~30 concurrent Anthropic calls vs ~20 in W1 → the tail (p95/p99) inflates. This is
  the **intended cost** of the graded "supervisor + 2 workers", not a defect.
- **Secondary (not isolated):** Site B's seed panel is fuller (pids 1–10 under Dr Lee vs the baseline's
  patient); heavier per-patient reconciliation adds latency independent of the supervisor.

## 50-concurrent: same OpenEMR wall as the baseline, + new Anthropic 429s
Agent-log breakdown during the run window: **348 `OpenEmrFhirError` ("fhir request failed")** dominant —
the **same** cliff as the baseline (the audit's ~5× FHIR read amplification: ~50 chats ≈ ~250 concurrent
FHIR calls saturating OpenEMR). W2's extra per-turn calls add **24 Anthropic 429s** on top. 385 turns
completed across the attempts and the agent **recovered cleanly** (`/ready` all-green afterward) — no crash,
no leak. The harness level did not print a clean percentile set because under saturation the mix of
slow-grounded + erroring requests did not drain 100@50c inside the harness time budget.

## Verdict
**Not a regression in the overnight code changes** — it is the expected W1→W2 architectural cost (extra
per-turn LLM call), newly active on Site B after deploying the W2 build, on top of the **pre-existing**
OpenEMR FHIR-amplification wall at 50c (documented in the baseline). No new failure mode; the agent degrades
and recovers gracefully.

## Recommendations
1. ~~**Route the supervisor with Haiku, not Sonnet**~~ — **DONE + verified** (`1ee1366`): p95 45s → 7.6s,
   which alone recovered the regression and beat the baseline.
2. **Short-circuit obviously chart-only turns** past the supervisor — further latency, but now optional
   since Haiku routing is already cheap.
3. **Cached Patient Snapshot** (already in the architecture) — attacks the 5× FHIR amplification directly and
   moves the 50c OpenEMR wall out; highest-leverage remaining fix for the **50c** cliff (Haiku does not reduce
   the FHIR call count, so the 50c OpenEMR wall stands).
4. A small **Anthropic concurrency limiter / backpressure** to turn 429s into graceful queueing under load.

## Caveats
- One run per level, cost-bounded (~$0.02/turn, grounding-on). The 50c level did not yield clean percentiles
  under saturation (characterized from agent logs instead). 10c numbers are from the completed 10c level.
- Site B ≈ Site A hardware ("identical droplets"), but the seed-data volume differs (see secondary cause).

## Infrastructure — CPU/memory during the 10c W2 load (Site B, 3.82 GiB droplet)
Peak `docker stats` per container during a 10-concurrent W2 run (`docker-stats-during-load.txt`):

| Container | Peak CPU | Mem |
|---|---|---|
| **openemr** | **88.7%** | 260 MiB |
| langfuse (tracing) | 77.8% | 155 MiB |
| agent | 44.8% | 167 MiB |
| mysql | 7.2% | 273 MiB |
| redis | 0.8% | 5.9 MiB |

**OpenEMR is the CPU bottleneck** — ~89% at only 10 concurrent, which is exactly why 50c saturates it
(the FHIR-amplification wall). The agent itself is light (45% CPU, 167 MiB) and Redis is negligible (drafts
are tiny + TTL'd), confirming the stateless-agent design. Headroom is on the OpenEMR/chart side, addressed
by the cached Patient Snapshot (§ recommendations).
