# Spec — Observability dashboard (E4)

Status: **Built (2026-07-10)**, except the Langfuse `verdictOk` score (see below).
`packages/metrics` (pure registry, 12 tests) + per-tool isolation in the graph
(`readSource`, 3 tests) + `GET /metrics` / `GET /dashboard` behind a bearer token
(10 tests) + turn recording in `/chat` (4 tests). 165 tests green, typecheck clean.
**Live-verified** with OpenEMR down: all five tool reads failed, each was attributed
individually, and the turn still completed and answered "I can't confirm that from the
record" — where the previous `Promise.all` would have 500'd the request.

**Not built from this spec:** emitting `verdictOk` as a Langfuse *score*. The live
window aggregates verification pass/fail correctly, but Langfuse still cannot answer
"what was the verification pass rate last week" without a score on the trace. Small
follow-up; the `Tracer` interface needs a `score()` method.

Traces to engineering requirement **E4** (dashboard: request
count, error rate, p50/p95, tool-call counts, retries, verification pass/fail) and
unblocks **E7** (≥3 alerts + on-call docs), which evaluates thresholds against the
surface this spec defines. Related: `.claude/rules/error-handling-and-logging.md`,
`ARCHITECTURE.md §2.6` (observability is self-hosted), `loadtest/results/` (supplies
the real thresholds).

## Problem

Langfuse holds a durable, per-request trace of every turn — spans per graph node,
generations with token counts and cost, all keyed by correlation ID. That answers
*"what did this one request do?"* It does not answer *"is the service healthy right
now?"*, which is the question an on-call engineer asks and the question an alert
must evaluate. There is no aggregate view and nothing for E7 to fire on.

Two gaps surfaced while scoping this, both of which E4 forces us to close:

1. **No per-tool observability.** All five chart tools are awaited in a single
   `Promise.all` under one `assembleContext` span (`apps/agent/src/graph/graph.ts`).
   There is no per-tool latency, call count, or failure attribution. `Promise.all`
   also rejects the whole turn on the first tool failure — so a single OpenEMR FHIR
   500 fails the entire request instead of degrading to a partial, labeled answer.
   That is a standing violation of `.claude/rules/error-handling-and-logging.md`
   ("tool failures are typed and surfaced, not swallowed... the agent continues with
   what it has") and it is the load test's #2 ranked fix.
2. **`verdictOk` never reaches the trace.** It rides on the SSE `done` event only,
   so verification pass/fail is not aggregable from Langfuse either.

## Behavior

### Metrics registry (pure module)

A pure, in-process `MetricsRegistry` in `packages/` records observations and returns
a snapshot. It is **not** durable and does not need to be: Langfuse is the durable
historical record (traces persisted to `langfuse-db`). The registry answers only
*"what is happening now"*, over a bounded rolling window. A process restart resetting
it is correct behavior, not data loss.

Recorded per `/chat` turn:

- `requests_total`, `requests_failed` → **error rate**
- turn latency observations → **p50 / p95** (exact percentiles over the retained
  window, not an approximation — the window is small enough)
- per-tool: `calls_total`, `failures_total`, latency observations, keyed by tool name
- `retries_total`, keyed by the operation retried
- `verification_pass_total` / `verification_fail_total`, where "fail" means the turn
  ended with `verdictOk === false` (a claim was dropped or a citation failed)

The window is a fixed-size ring buffer of the most recent N turns (N configurable,
default 1000). Counters are monotonic since process start; percentiles are computed
over the window.

### `GET /metrics`

Returns the snapshot as JSON. Unauthenticated is **not** acceptable — the snapshot is
operational, not clinical, and carries **no PHI** (no pid, no correlation ID, no
patient data; tool names and counts only), but it does leak traffic volume and error
posture. Gated by a bearer token from env (`COPILOT_METRICS_TOKEN`); absent env var →
route not registered. See Open questions.

### `GET /dashboard`

A single served HTML page rendering the `/metrics` snapshot: request count, error
rate, p50/p95, a per-tool table (calls, failures, p95), retries, and verification
pass/fail. Auto-refreshes on an interval. Same auth gate as `/metrics`. No build step
— server-rendered string, consistent with the existing `routes/ui.ts` dev page.

### Per-tool instrumentation (the enabling change)

`assembleContext` moves from `Promise.all` to `Promise.allSettled`, with each tool
call wrapped in its own `tracedSpan(`tool:${name}`, …)`. On a rejected tool:

- the failure is recorded to the registry and the span ends with `error`;
- the corresponding fact is `null`, which the downstream prompt already renders as
  "no data on file" — **but that is wrong for a *failed* read**, which is not the same
  as an absent record (`.claude/rules/provenance-and-grounding.md`: absence ≠ negative
  finding). The fact must be marked **unavailable**, distinct from **absent**, and the
  answer must say the source could not be read.
- The turn as a whole still succeeds (degrades), rather than 500ing.

### Langfuse score

On turn end, emit `verdictOk` as a Langfuse score so the durable side can aggregate
verification pass/fail over time, not just the live window.

## Boundaries

- **Not** an archive of load-test runs. `loadtest/results/` is the point-in-time
  record; the dashboard shows live traffic only.
- **Not** a longitudinal/trend view. "Is p95 creeping up week over week" is a Langfuse
  query against persisted traces.
- **Does not** replace Langfuse for per-request drill-down.
- **No new containers.** `ARCHITECTURE.md §8` fixes the deploy shape; Prometheus and
  Grafana are out of scope, and hosted tracing is already rejected (PHI).
- Metrics are per-process. No cross-replica aggregation (there is one replica).

## Acceptance criteria

1. Given 3 successful turns and 1 failed turn, the snapshot reports
   `requests_total: 4`, `requests_failed: 1`, `error_rate: 0.25`.
2. Given latency observations `[100, 200, 300, 400]`, the snapshot reports
   `p50: 200` and `p95: 400` (nearest-rank).
3. Given a turn where the `medications` tool rejects and the other four resolve, the
   snapshot reports `tools.medications.failures_total: 1`, the other four report
   `failures_total: 0` and `calls_total: 1`, **and the turn is not counted as a failed
   request** (it degraded).
4. In that same turn, the assembled facts mark `medications` as **unavailable**, not
   absent, and the rendered answer states the medication source could not be read
   rather than implying no medications are documented.
5. Given a turn ending `verdictOk: false`, `verification_fail_total` increments and
   `verification_pass_total` does not.
6. The registry retains at most N observations; the (N+1)th evicts the oldest, and
   percentiles reflect only the retained window.
7. `GET /metrics` without a valid bearer token → 401, and the body contains no metric
   values.
8. `GET /metrics` returns a payload containing no pid, no correlation ID, and no
   patient data (asserted structurally).
9. `GET /dashboard` renders every E4 metric: request count, error rate, p50, p95,
   per-tool call counts, retries, verification pass/fail.
10. A rejected tool emits a Langfuse span ending in `error` naming that tool.

## Open questions

- ~~**Retries have no source.**~~ **DECIDED 2026-07-10 (user):** ship `retries_total`
  at zero, explicitly labeled on the dashboard as "no retry path implemented" so it
  never reads as "we retry and it never fires." Nothing in the agent retries: the only
  match is `maxRetriesPerRequest: 1` on the Redis client, and the generate node
  degrades on a transient LLM failure rather than retrying.
  **~~Carries a known debt~~ RESOLVED 2026-07-10:** `.claude/rules/verification-gate.md`
  prescribes a *bounded regenerate-with-feedback* before degrading on a failed grounding
  check. It is now built (`checkGroundingWithRegeneration`; see
  `docs/specs/grounding-judge.md`): the `grounding` node retries once with the judge's
  feedback and records the count via `metrics.recordRetry`. `retries_total` is no longer
  a hardcoded zero — it is a real counter and `retryPathImplemented` is now `true`; the
  dashboard's "no retry path implemented" note is removed. It reads zero only when no
  retry has actually fired (e.g. the judge is off, or first attempts all ground).
- ~~**`/metrics` auth.**~~ **DECIDED 2026-07-10 (user):** bearer token from
  `COPILOT_METRICS_TOKEN`; absent env var → routes not registered. Chosen over
  internal-network-only because E7's alert runner and the demo both need to reach it
  over the public URL.
- **Window size N.** Default 1000 turns. At the demo's traffic this is effectively
  "all of them"; under the 50-concurrent load test it is ~10 minutes. Not blocking.
- Should the dashboard show a **freshness/uptime** indicator (process start time), so
  a viewer can tell the counters reset? Cheap; leaning yes.
