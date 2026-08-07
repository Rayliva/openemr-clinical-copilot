# On-call runbook — Clinical Co-Pilot agent

The operational guide for whoever is on-call for the agent service. Pairs with the
alert rules (`docs/specs/alerts-and-oncall.md`) and the live dashboard (E4). This
service is **read-only** and surfaces existing chart data; it never writes to OpenEMR,
so there is no data-corruption failure mode — the failure modes are availability,
latency, and (most importantly for this system) **trust**.

## Where to look first

| Surface | URL | What it tells you |
|---|---|---|
| Dashboard | `GET /dashboard?token=$COPILOT_METRICS_TOKEN` | Live request count, error rate, p50/p95, per-tool failures, verification pass/fail |
| Alerts | `GET /alerts` (bearer `$COPILOT_METRICS_TOKEN`) | Which rules are firing right now, with value + threshold |
| Health | `GET /health` / `GET /ready` | `/ready` validates each dependency (critical: redis, openemr, anthropic, langfuse) plus the **W2 non-critical** probes `document_storage` (OpenEMR document reachability), `vector_index` (the in-memory guideline index built at startup), and `reranker` (Cohere rerank reachability). Three-state: `ready` / `degraded` (200; a non-critical W2 dep is down, chart answers still work) / `not_ready` (503; a critical dep failed) |
| Traces | Langfuse UI | Per-request span tree, tokens, cost — search by correlation ID. W2: worker spans (`worker:*`) nest under the `supervisor` span |
| Logs | `pino` JSON (stdout / aggregator) | Structured; every line carries `correlationId`; firing alerts log `msg: "alert firing"`. W2 event vocabulary (`ingestion.complete`, `extraction.field`, `retrieval.hit`/`retrieval.miss`, `worker.handoff`) is documented in `docs/specs/w2-observability.md §6` — PHI-free, object-context only |

**Tracing a single bad request:** every response carries an `x-correlation-id` header,
and every log line and Langfuse trace is keyed by it. Take the correlation ID from the
user's failed request → search Langfuse → see exactly which node/tool failed.

## Making alerts active

`/alerts` evaluates on request (it is pull-based, so the agent stays stateless). To make
alerts *active* rather than *pull-only*, an operator runs a poller on an interval — e.g.
a cron every 60s that curls `/alerts` and forwards any `status: "firing"` to your paging
channel. **v1 does not ship a paging integration** (no external service is in the
trust-boundary review, and there is no CI/automation in v1); firing rules are written to
the logs at `warn`/`error` in the meantime. The webhook seam is a one-line addition when
a delivery target is chosen (`docs/specs/alerts-and-oncall.md` open questions).

## Alerts

### `high_error_rate` — turns are failing outright
- **Means:** the fraction of turns that errored is ≥ 10% (warning) or ≥ 50% (critical).
  Healthy baseline is ~0%.
- **Most likely cause:** a dependency is down or saturated. In the E9 load test the
  errors were *all* OpenEMR FHIR 500s under read amplification (see systemic risk below).
- **First step:** open `/dashboard`; look at the per-tool table. If the failures cluster
  on the chart tools, it is OpenEMR, not the agent. Check `/ready` for `openemr`.
- **Mitigation:** if OpenEMR is saturated, shed load (lower concurrency) and check
  OpenEMR's own health (CPU, MariaDB). If Anthropic is erroring, check status and keys.
- **Escalate:** to whoever owns the OpenEMR instance if the FHIR layer is the cause.

### `high_latency_p95` — the slow tail is slow
- **Means:** p95 turn latency ≥ 15 s (warning) or ≥ 30 s (critical). Healthy
  grounding-on p95 is ~10 s; the 50-concurrent overload cliff hit ~32 s.
- **Most likely cause:** OpenEMR FHIR reads slowing under concurrency, or LLM latency.
- **First step:** `/dashboard` per-tool p95 vs the LLM. High tool p95 → OpenEMR; low tool
  p95 but high turn p95 → the model (generation or the grounding judge).
- **Mitigation:** the durable fix for tool-side latency is the Redis snapshot cache (see
  systemic risk). For LLM latency, consider disabling the grounding judge for a spike
  (`COPILOT_GROUNDING_JUDGE=false`) — but note this removes verification layer 2, a trust
  tradeoff, so only as a deliberate, temporary measure.
- **Escalate:** if sustained and load is normal, it is a regression — page the dev owner.

### `tool_failure_rate` — a chart source is failing (FHIR-saturation early warning)
- **Means:** the worst per-tool failure rate is ≥ 10% (warning) or ≥ 30% (critical).
  Because tool reads are isolated (E4), this rises *before* whole turns fail — it is the
  earliest signal of the documented root cause.
- **Most likely cause:** OpenEMR FHIR saturation. The agent fans out five FHIR reads per
  turn; under concurrency that is 5× amplification against OpenEMR's PHP/MariaDB layer.
- **First step:** the alert names the worst tool. Confirm on `/dashboard`; check
  OpenEMR's CPU/DB. One tool failing alone can also mean a missing OAuth scope for that
  resource.
- **Mitigation:** reduce concurrency; longer term, wire the Redis snapshot cache to
  collapse 5 reads → 1 (the load test's #1 recommendation).
- **Escalate:** OpenEMR owner if the FHIR layer is saturating.

### `verification_fail_rate` — the trust gate is dropping many claims
- **Means:** ≥ 20% (warning) or ≥ 50% (critical) of turns ended unverified — a claim was
  dropped by the grounding judge or a citation did not resolve. This is a **trust** alert,
  not an availability one, and it is the one most specific to what this system is for.
- **Most likely cause:** model drift, a prompt regression, degraded/empty chart data
  (which correctly produces "can't confirm"), or a grounding-judge model change.
- **First step:** pull a few recent unverified turns from Langfuse by correlation ID and
  read what the grounding judge rejected. Distinguish *correct* rejections (bad/empty
  data → honest degradation, working as designed) from a *regression* (good claims being
  dropped).
- **Mitigation:** if a prompt or model change caused it, roll back that change. Do **not**
  weaken the gate to clear the alert — a silent pass is worse than an honest "can't
  confirm" (`.claude/rules/verification-gate.md`).
- **Escalate:** dev owner; this is a correctness/safety regression, not an ops blip.

## Known systemic risk — FHIR read amplification

Every `/chat` turn fans out **five** FHIR reads (demographics, problems, medications,
allergies, immunizations) with no snapshot cache. At 50 concurrent that is ~250
concurrent FHIR calls, which saturates OpenEMR (E9: 73% error, all FHIR 500s). Per-tool
isolation (E4) already stops one failure from killing a whole turn, but the amplification
itself is unfixed. **The durable fix is the Redis Patient Snapshot cache** (collapses 5
reads → 1, per `ARCHITECTURE.md §3`) — the top-ranked item in `loadtest/results/`. If
`tool_failure_rate` or `high_latency_p95` fires under real load, this is the root cause
and the fix.

## Week 2 failure modes & recovery (document ingestion + RAG + eval gate)

Week 2 adds document extraction, guideline RAG, and the multi-agent graph. These are new
failure surfaces on top of the W1 ones above. All of them **degrade** rather than crash —
chart answers keep working even when the W2 paths are down. Source: `W2_ARCHITECTURE.md §17`.

| Failure | How to spot (logs / dashboard / `/ready`) | Recovery action |
|---|---|---|
| **Document ingestion failure** (unreadable file, VLM error) | `ingestion.error` event; extraction failure-rate alert | Surface "couldn't read this document" to the physician; retry with backoff; leave the doc **pending** — no partial write. |
| **Extraction schema violation** (VLM emits out-of-contract fields) | `schema_invalid` / the `schema_valid` metric; log event | Bounded retry with schema feedback, then **degrade** — flag the offending fields; **never** bypass the Zod schema. |
| **Value-not-on-page** (possible VLM hallucination) | field flagged `unverified` in review; low box-match confidence | **Forced to the top of physician review**; not committed until the physician confirms or edits it. Working as designed, not an ops incident. |
| **RAG returns no results** | retrieval hit-rate = 0; `retrieval.miss` event | Answer "no supporting guideline evidence found" (absence ≠ negative finding); **never fabricate** evidence. |
| **Reranker (Cohere) down / slow** | `/ready` degraded; RAG-latency alert; circuit-breaker open | Fall back to the fused **pre-rerank** top-k with an "unreranked" label, or degrade the evidence path; timeouts prevent a hung turn. |
| **VLM timeout / slow** | extraction-to-draft latency alert; span shows a stalled VLM call | Timeouts + retries on the outbound call bound the wait; on exhaustion the doc stays **pending** (no partial extraction committed); the physician retries from the review surface. |
| **Supervisor routing error** (invalid decision) | `supervisor.decision_invalid`; span shows no valid route | Reject the malformed decision; default to a **safety-core-only** answer + "couldn't route to extraction/evidence." |
| **Evidence retrieval unavailable** (embedder/index error; Cohere embed down in prod) | `/ready` degraded; retrieval error event | Evidence path degrades; **chart answers still work**. The RAG index is **in-memory** and rebuilds from the committed corpus on restart — there is **no database to recover**. |
| **PHI leak risk** in a trace / log | `no_phi_in_logs` scorer red in the eval gate | **Block the change**; scrub; the gate is a hard blocker. See [`w2-privacy-audit.md`](w2-privacy-audit.md). |

**New W2 alerts** (each with a documented response; `W2_ARCHITECTURE.md §9`). These are live
metrics rules in `packages/metrics/src/alerts.ts`, evaluated by `GET /alerts` and surfaced on
`/dashboard` (the W2 sections). Rule names are in `code`:

- **Extraction failure rate** (`extraction_failure_rate`) — the fraction of document extractions
  that degraded (schema-invalid / unreadable), warning ≥ 20%, critical ≥ 50% (gate: ≥ 5
  extractions). Response = the ingestion rows above (retry → degrade → leave pending). Sustained ⇒
  page the dev owner (likely a VLM model/prompt regression or a schema drift). First look:
  `/dashboard` → Document ingestion → the per-doc-type Degraded column.
- **RAG retrieval latency** (`rag_retrieval_latency`) — p95 of the guideline retrieve+rerank
  round-trip, warning ≥ 4 s, critical ≥ 8 s. The Cohere embed/rerank round-trip is the usual cause;
  the circuit-breaker + "unreranked" fallback keep answers flowing (watch the Rerank-degraded card).
  If Cohere is the cause, check provider status and `/ready` (`reranker` shows as `degraded`, not
  down); the offline embedder is the zero-egress fallback.
- **Supervisor hop-cap rate** (`supervisor_hop_cap_rate`) — the fraction of routed turns where the
  supervisor hit its hop cap (the loop backstop fired instead of the router converging), warning
  ≥ 20%, critical ≥ 50% (gate: ≥ 10 routed turns). A rising rate means the router is looping —
  read the routing rationale in the Langfuse traces (the `supervisor:decision` child spans) to see
  what it keeps choosing. Mitigation: revert a recent supervisor-prompt/model change; the turn
  already degrades to a safety-core answer, so it is a quality alert, not an outage. Escalate to
  the dev owner if sustained.
- **Eval regression detection** (`eval_regression_detection`) — the worst per-category failure rate
  of the deterministic per-encounter eval checks (`schema_valid`, `citation_present`, `grounding_ok`,
  `no_phi_in_logs`), warning > 5% failing, critical > 10% (gate: ≥ 10 samples per category). This is
  the **runtime** analog of the offline > 5%-regression rule; the authoritative gate remains the
  pre-push eval hook. Response: do **not** weaken the gate to clear it — find and revert the
  regressing change (`.claude/rules/w2-eval-gate.md`); the safety subset must stay 100%. First look:
  `/dashboard` → Eval categories → the per-category pass rate; `/alerts` lists the rule by name in
  any state.

**The one write path — no data-corruption failure mode, by construction.** The derived-
`Observation` write is idempotent (same document + code + value ⇒ no-op) and only ever runs
on a **physician-confirmed** value, so a re-open or a double-submit cannot duplicate or
overwrite chart data. If a wrong value reaches the chart it is a **review** failure (the
physician confirmed it), not a system failure — the audit trail is the `derivedFrom` link +
the provenance stamped in the observation description.

## Escalation summary
- **OpenEMR / FHIR saturation** (error rate, tool failures, tool-side latency) → OpenEMR
  instance owner.
- **Verification regressions** (verification fail rate) → agent dev owner; never mask.
- **LLM provider** (Anthropic errors/latency) → check provider status; rotate keys if auth.
- **W2 extraction / RAG** (extraction failure rate, RAG latency) → agent dev owner; Cohere
  provider status if egress-side. Never weaken the eval gate to clear a regression alert.
