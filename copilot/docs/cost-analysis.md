# AI Cost Analysis — Clinical Co-Pilot

Traces to the **AI cost analysis** deliverable: actual dev spend + projections at
100 / 1K / 10K / 100K users, plus the architectural shifts that change the curve.

Every number here is **measured**, not assumed — sourced from Langfuse (actual metered
spend), the agent logs (token distributions), the Anthropic `count_tokens` API (prompt
decomposition), and a **live prompt-caching experiment** against the real API. Where a
variable genuinely cannot be measured yet (there is no production traffic), it is made
an explicit sensitivity axis rather than a single guessed number.

> **Refreshed 2026-07-19 (final build `a0837c0`):** Site B's Langfuse now meters **$2.70 across 577
> traces** over the 5-day W2 build window (input 526K / output 75K tok) — the whole project's traced
> LLM spend is still **single-digit dollars**. The per-turn cost + projection methodology below are
> unchanged (measured invariants). Final latency numbers are in
> `loadtest/results-2026-07-19-siteB/loadtest-comparison.md` (single-user ~0.84 s p50; 10c p50 8.4 s /
> p95 28 s / 0% error — concurrency-bound on the single Anthropic key). The $0.53 figure below is the
> original earlier snapshot, kept for the measured methodology it documents.

## TL;DR
- **Actual dev spend: $0.53** (Langfuse, 97 traces / 83 real Claude generations) — earlier snapshot;
  the final build meters ~$2.70 (577 traces) per the refresh note above.
- **Cost per turn: p50 $0.0058, mean $0.0067, p95 $0.0098** (`claude-sonnet-5`, std
  pricing). Input is near-constant (~1,300 tok); **output variance (34–419 tok) drives
  the spread.**
- **58% of input tokens is structured-output schema overhead**, not patient data —
  measured. This, not user count, is the biggest controllable per-turn cost.
- **Prompt caching gives ~0% today** — verified by experiment: the current prompt is
  cacheable in size but the agent sets no `cache_control`, and caching only pays off for
  *multi-turn, same-patient* conversations. (My first draft overstated this; the
  experiment corrected it.)
- Projections are a **range across two axes** (turns/provider/day × scale), because
  turns/day is unmeasurable pre-launch. At the mid assumption, 100K providers is
  **~$1.6M–3.3M/yr LLM**, movable ~25–45% by the levers below. A **per-API-key
  throughput ceiling** (~300 turns/min) is a real non-linear constraint before cost is.

## Pricing (Anthropic, 2026-07)
`claude-sonnet-5`: **$3 / $15** per 1M in/out (intro $2 / $10 to 2026-08-31).
`claude-haiku-4-5`: $1 / $5. Caching: read **0.1×**, write **1.25×** (5-min) / 2× (1h).

## 1. Actual dev spend (measured, Langfuse)
`GET /api/public/metrics/daily`:

| Metric | Value |
|---|---|
| Traces (chat requests) | 97 |
| Real `claude-sonnet-5` generations | 83 (14 were dev-stub / 0-token) |
| Input / output tokens | 108,376 / 13,597 |
| **Total metered cost** | **$0.529** |

This is the whole project's traced spend to date — the workload is inherently
low-token (read-only, minimum-necessary prompts). Evals are deterministic (no grader
LLM), so eval spend is $0.

## 2. Cost per turn (measured distribution, 83 real turns)
| Tokens | p50 | p95 | max |
|---|---|---|---|
| Input | 1,295 | 1,307 | 1,846 |
| Output | 126 | 389 | 419 |
| **Cost/turn (std)** | **$0.0058** | **$0.0098** | — |

Mean $0.0067. **Input is nearly flat** (the prompt is dominated by fixed scaffolding);
**output is the variable** — a demographics lookup (~34 tok) costs a third of a full
reconciliation+safety answer (~419 tok). Projections below therefore carry a p50–p95
band, not a point.

## 3. Where the input tokens go (measured via `count_tokens`)
| Segment | Tokens | Varies with |
|---|---:|---|
| System framing (rules) | 172 | nothing (fixed) |
| Patient FACTS (demographics + reconciled meds + allergies) | 378 | patient |
| **Structured-output schema / SDK scaffolding** (`generateObject`) | **~755** | nothing (fixed) |
| **Total billed input/turn** | **~1,305** | |

The hand-built prompt (framing + facts + question) is only **550 tokens**; the agent
*logs* ~1,305. The **~755-token gap is the Vercel AI SDK's structured-output tooling** —
i.e. **structured output roughly triples input tokens**, and is **58% of every turn's
input cost**. It is identical on every turn and every patient — the prime optimization
and caching target.

## 4. Prompt caching — measured, not assumed (and it corrected my first draft)
A live two-turn experiment (`cache_control` on the system prefix, `usage` inspected):

| Prefix size | turn-1 `cache_creation` | turn-2 `cache_read` | caches? |
|---|---:|---:|---|
| 550 tok (framing+facts only) | 0 | 0 | **no — below minimum** |
| 1,257 tok | 1,251 | 1,251 | yes |
| 1,705 tok | 1,699 | 1,699 | yes |
| 2,825 tok | 2,819 | 2,819 | yes |

Findings:
- **Minimum cacheable prefix ≈ 1,024 tok** for `claude-sonnet-5` (0 at 550, engages by
  1,257). The agent's real ~1,305-tok prompt is *above* it — cacheable in principle.
- **Benefit today = 0%.** The agent sets no `cache_control`, so nothing caches. Even
  the auto-cache path is off.
- **If implemented, caching only helps multi-turn, same-patient conversations.** The
  stable prefix (schema + framing ± facts) would read at 0.1× on turns 2+. For a 3-turn
  same-patient conversation that's **~30–35% off the conversation**, but turn 1 pays a
  1.25× write premium — so **single-turn queries get *nothing* (slightly worse)**. Since
  many clinical queries are one-shot, blended caching benefit is modest, not the 30–40%
  I first claimed.
- The larger, always-present cacheable chunk is the **755-tok schema** — but the AI SDK
  doesn't place `cache_control` on it today. Realizing that is an implementation change.

## 5. Usage model — the one variable we cannot measure yet
There is no production traffic, so **turns/provider/day is unknown**. Rather than pick
one number and multiply, it is the sensitivity axis. Anchors: a PCP sees ~20 patients/
workday; co-pilot use per encounter and conversation length are the unknowns. Table
uses **5 / 20 / 50 turns/provider/workday** × **21 workdays** = 105 / 420 / 1,050
turns/provider/month.

## 6. Projections (LLM only, standard pricing, p50–p95 band)
Per-turn band $0.0058–$0.0098; mid usage = 420 turns/provider/mo.

| Providers | @5 turns/day /mo | @20 turns/day /mo | @50 turns/day /mo |
|---|---|---|---|
| 100 | $61–$103 | $244–$412 | $609–$1,030 |
| 1,000 | $0.6K–$1.0K | $2.4K–$4.1K | $6.1K–$10.3K |
| 10,000 | $6.1K–$10K | $24K–$41K | $61K–$103K |
| 100,000 | $61K–$103K | $244K–$412K | $609K–$1.03M |

**Annualized at the mid (20 turns/day) assumption:** 100 → ~$3.9K; 1K → ~$39K; 10K →
~$390K; 100K → **~$3.9M** (p95) / **~$2.9M** (mean) / **~$2.3M** (p50). Intro pricing ×0.67.

## 7. Cost levers, quantified from the measurements above
| Lever | Mechanism | Effect (measured basis) |
|---|---|---|
| **Trim structured-output schema** | 58% of input is the `generateObject` schema; a leaner schema or tool-call output shrinks it | Input is ~60% of per-turn cost → a 40% schema cut ≈ **~25% off every turn**, single- and multi-turn alike. Biggest, most reliable lever. |
| **Prompt caching** (implement `cache_control`) | Cache the stable schema+framing prefix | **~30–35% off multi-turn same-patient** turns; **0% (slightly negative) single-turn**. Blended benefit depends on conversation mix (unmeasured). |
| **Model tiering to Haiku** | Route demographics/simple turns to `claude-haiku-4-5` (⅓ cost); safety turns stay on Sonnet | If ~40% of turns qualify → **~25% blended**, stacks with the above |
| **Deterministic verification** | Constraint engine + citation check are pure code | **$0 LLM** — already realized; keeps safety logic off the model |
| **Layer-2 grounding judge** (now ON in prod, `claude-haiku-4-5`) | One judge call per *claim*, each seeing only the cited row (small input); Haiku pricing | **+30–50%/verified turn** on cost, and it dominates *latency* (eval run: p50 7.5s / p95 13.7s end-to-end vs sub-second gen alone). Kept on per the physician's faithfulness requirement; Haiku tiering blunts the cost, not the latency |

Realistically, schema-trim + tiering take the 100K mid figure from ~$2.9M toward
**~$1.6–2.0M/yr**; the now-enabled grounding judge adds some of that back.

## 8. Non-linearities (why it isn't just users × cost)
- **Per-API-key throughput ceiling.** At ~1,305 input tok/turn, an org input-rate limit
  of *R* tok/min caps sustained throughput at **R / 1,305 turns/min**. At a representative
  R≈400K ITPM that's **~300 turns/min (~18K/hr) per key** — a hard wall hit *before* cost
  becomes the constraint at 10K+ providers, forcing higher tiers, multiple keys, or
  request shaping. Tier-dependent; the *mechanism* is the point.
- **Bursty clinic load.** Turns concentrate in clinic hours, so peak ≫ average — capacity
  must be sized to peak, not the monthly mean the table implies.
- **Volume/committed-use discounts** reduce the ≥10K-provider figures below the linear
  projection (directional; not modeled numerically — depends on contract).
- **Caching write premium** makes naive caching *raise* cost on one-shot traffic — a
  non-linearity in the wrong direction if applied blindly.

## 9. Infra (non-LLM), real DigitalOcean list prices
- **MVP:** sidecar + Redis + self-hosted Langfuse on one droplet — ~$12–24/mo
  (2–4 GB droplet). Self-hosting Langfuse is a PHI/BAA choice, not a cost one.
- **1K–10K providers:** sidecar replicas + managed Redis (~$15/mo up) + a Langfuse DB
  with retention — low hundreds $/mo.
- **100K providers:** multi-node + managed Postgres for Langfuse — low thousands $/mo,
  still **~2 orders of magnitude below LLM spend**. OpenEMR/FHIR read load grows with
  turns; the planned Redis snapshot cache is the mitigation.

## 10. Limitations
- **turns/provider/day is unmeasured** (no production traffic) — hence the range, not a
  point. The per-turn cost *is* measured and is the robust invariant.
- Token profile reflects the current toolset (demographics + meds + allergies). New
  tools (labs, notes) raise input/turn — re-baseline via the agent `usage` logs.
- Blended caching benefit needs real conversation-length data to pin down; the
  per-scenario bounds (0% single-turn, ~30–35% 3-turn same-patient) are measured.
- Excludes retries and the caching write premium from headline numbers (second-order at
  this prompt size).
