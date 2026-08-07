# Spec — Alerts + on-call docs (E7)

Status: **Built (2026-07-10).** `evaluateAlerts` + `firingAlerts` in `@copilot/metrics`
(4 rules, volume gate; 8 unit tests) + `GET /alerts` behind the metrics token, logging
firing rules structured (4 route tests) + `docs/oncall.md` runbook. 189 tests green,
typecheck clean, `/alerts` live-verified (401 without token; `{status:"ok",alerts:[]}`
healthy). Delivery is log-only in v1 (documented seam), per the open questions below.
Traces to engineering requirement **E7** (≥3 alerts + on-call docs). Builds directly on **E4** (`GET /metrics`, `docs/specs/observability-dashboard.md`)
for the signal and **E9** (`loadtest/results/`) for the thresholds. Related:
`.claude/rules/error-handling-and-logging.md`, `ARCHITECTURE.md §2.6` (self-hosted
observability), `.claude/rules/phi-and-secrets.md`.

## Problem

E4 exposes the live operational state, but nothing *watches* it. An on-call engineer
would have to stare at the dashboard to notice the service degrading. E7 asks for
alerts — thresholds evaluated against the metrics, firing when the service is unhealthy
— plus the on-call documentation that says what to do when one fires.

There is no alerting system in the stack: Langfuse has none, and `ARCHITECTURE.md §8`
fixes the deploy shape (no Prometheus/Alertmanager, no new containers). So alerts are
defined and evaluated **in the agent**, against the same `/metrics` snapshot the
dashboard reads.

## Behavior

### Alert rules (deterministic evaluation)

A pure `evaluateAlerts(snapshot, config?)` in `@copilot/metrics` takes a
`MetricsSnapshot` and returns one `AlertOutcome` per rule:
`{ name, status, value, threshold, description }`, where `status` is
`ok | warning | critical | insufficient_data`. Deterministic, no I/O, unit-tested. The
`/alerts` endpoint derives the firing set (`status` warning or critical) from these.

Each rule reads a field already in the snapshot (no new metric needed) and has a
warning and a critical threshold. Thresholds are grounded in the E9 load test (10
concurrent: 0% error, p95 ~10s; 50 concurrent: 73% error, p95 ~32s, all OpenEMR FHIR
500s), not invented.

**Minimum three alerts (the rubric floor); we ship four:**

1. **`high_error_rate`** — `errorRate`. Warning ≥ 0.10, critical ≥ 0.50. At 50
   concurrent the error rate was 0.73; 0.10 is well above the healthy 0% baseline so it
   won't flap on a single failure. *Only evaluated once a minimum request volume is
   seen (see below), so one failed request out of two doesn't page at 50%.*
2. **`high_latency_p95`** — `latencyMs.p95`. Warning ≥ 15000 ms, critical ≥ 30000 ms.
   Healthy grounding-on p95 is ~10 s; 50 concurrent hit 31.7 s. 15 s = "slower than
   normal," 30 s = "as bad as the overload cliff."
3. **`tool_failure_rate`** — max over tools of `failuresTotal / callsTotal`. Warning ≥
   0.10, critical ≥ 0.30. This is the **OpenEMR-FHIR-saturation early warning**: the E9
   failures were *all* FHIR 500s, and per-tool isolation (E4) means this rises before
   the whole turn fails. It catches the documented root cause at its source.
4. **`verification_fail_rate`** — `verificationFailTotal / (pass + fail)`. Warning ≥
   0.20, critical ≥ 0.50. A safety-relevant signal: a spike means the grounding gate is
   dropping many claims (model drift, a prompt regression, or bad chart data). Not a
   latency/uptime alert — a *trust* alert, which is what this system is about.

### Volume gate (anti-flap)

Rate-based rules (`high_error_rate`, `tool_failure_rate`, `verification_fail_rate`) do
**not** evaluate until a minimum sample (`minRequests`, default 20) is in the window.
Below that, one bad request would swing a ratio wildly and page falsely. Below the
gate the rule reports `insufficient_data`, not `ok` and not `firing`. `high_latency_p95`
needs at least one latency observation.

### `GET /alerts`

Returns the current evaluation as JSON: `{ status: "ok" | "firing", alerts: [...] }`,
where `alerts` lists every firing rule (most severe first) and `status` is `firing` if
any critical or warning is active. Same bearer-token gate as `/metrics` and `/dashboard`
(`COPILOT_METRICS_TOKEN`); the payload carries **no PHI** (rule names, numbers, severity
only). Registered only when the metrics token is set (fail-closed), same as `/metrics`.

### Firing is logged, not externally paged (v1)

When `/alerts` is evaluated and a rule is firing, the agent emits a structured `pino`
`warn` (critical → `error`) with the rule name, value, and threshold — queryable in the
logs, no PHI, no external service. **Actual paging (email/Slack/PagerDuty) is
deliberately not wired in v1**: it would add an external dependency the trust-boundary
review (`phi-and-secrets`, `ARCHITECTURE.md`) hasn't vetted, and `commit-and-deploy`
says no CI/automation in v1. The on-call doc documents the delivery seam — where an
operator polls `/alerts` or scrapes the logs, and where real paging would attach.

### On-call runbook — `docs/oncall.md`

One section per alert: **what it means**, **most likely cause** (grounded in E9 — e.g.
`tool_failure_rate` → OpenEMR FHIR saturation from read amplification), **first
diagnostic step**, **mitigation**, and **escalation**. Plus: how to reach `/alerts` and
`/dashboard`, how to read a correlation ID through to a Langfuse trace, and the known
systemic risk (the 5-FHIR-reads/turn amplification and its fix — Redis snapshot cache).

## Boundaries

- **No new containers / no external paging service** in v1 (architecture + PHI + no-CI
  constraints). Evaluation and exposure only; delivery is documented, not built.
- **No new metrics.** Every rule reads an existing `/metrics` field.
- Alerts are **per-process**, over the same rolling window as the dashboard — a live
  view, not a historical alert log. Langfuse holds history.
- Not a scheduler: `/alerts` evaluates on request. A cron/poller is an operator concern,
  documented in the runbook, not built here.

## Acceptance criteria

1. `evaluateAlerts` on a snapshot with `errorRate 0.6` and ≥ `minRequests` requests →
   the `high_error_rate` outcome has `status: critical`.
2. `errorRate 0.15` with enough volume → `high_error_rate` `warning`; `0.05` → `ok`.
3. `errorRate 0.6` but only 3 requests → `high_error_rate` `insufficient_data`, and it
   is **not** in the firing set (volume gate).
4. `latencyMs.p95 = 31000` → `high_latency_p95` critical; `16000` → warning; `9000` →
   `ok`; `p95 = null` (no data) → `insufficient_data` (not firing).
5. A snapshot where one tool has `failuresTotal 4 / callsTotal 4` (and volume met) →
   `tool_failure_rate` critical, and the outcome names the worst tool.
6. `verificationFailTotal 30 / passTotal 10` (volume met) → `verification_fail_rate`
   critical.
7. A fully healthy snapshot with volume → every outcome `ok`, and `/alerts` returns
   `{ status: "ok", alerts: [] }`.
8. `GET /alerts` without the bearer token → 401; with it → the evaluation JSON, no PHI.
9. At least one firing alert produces a structured `warn`/`error` log with rule name,
   value, and threshold (no interpolation, no PHI).
10. `docs/oncall.md` documents all four alerts with cause + first step + escalation.

## Open questions

- **Paging delivery** is documented, not built (see rationale above). If a live demo
  wants a visible page, the lightest honest addition is a single outbound webhook to a
  URL from env — still no PHI in the payload. Deferred unless asked.
- **Where the poller lives.** `/alerts` evaluates on request; something must call it on
  an interval to make alerts *active* rather than *pull-only*. v1 documents this as an
  operator cron in the runbook rather than building an in-process scheduler (keeps the
  agent stateless and matches "no automation in v1"). Revisit if a live poller is
  wanted.
