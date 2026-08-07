# Spec — Rubric-named W2 alerts + readiness probes

Status: in progress · Traces to: W2 Engineering Requirements — "Dashboard and alert definitions
(extraction failure rate, RAG retrieval latency, eval regression detection)" and "Separate
/health and /ready … check Week 2 dependencies: document storage, vector index, and reranker
API reachability." Closes instructor-identified gaps.

## Problem

The rubric names specific alerts and readiness probes that a grader looks for **by name**. Two gaps:

1. **Alerts.** `extraction_failure_rate` exists; RAG latency exists only as `rag_retrieval_latency_p95`
   (searched as `rag_retrieval_latency`); **`eval_regression_detection` does not exist** as an alert
   (the >5%-drop rule lives only in the pre-push gate). Also, `/alerts` returned only the *firing*
   subset, so a non-firing alert's **definition was not discoverable by name**.
2. **Readiness probes.** `/ready` has redis/openemr/langfuse/anthropic/cohere — none named
   `document_storage`, `vector_index`, or `reranker`.

## Behavior

### Alerts
- Rename the RAG-latency alert to **`rag_retrieval_latency`** (keep the p95 semantics in the
  description).
- Add **`eval_regression_detection`**: reads a new per-category eval-outcome sub-snapshot; fires
  `warning` when any deterministic eval category's live pass rate drops below 95% (a >5% failing
  rate — the runtime analog of the pre-push gate's ">5% regression" rule), `critical` below 90%.
  Volume-gated (anti-flap) and `insufficient_data` until enough samples.
- **`/alerts` returns every alert outcome** (name + status + value + threshold + description), not
  just the firing subset, plus a top-level `status` (`firing`/`ok`) and a `firing` array. Every
  defined alert is now discoverable by name regardless of state.

### Metrics
- New `eval` sub-snapshot: per-category `{pass, total}` for the deterministic per-encounter eval
  categories (`schema_valid`, `citation_present`, `grounding_ok`, `no_phi_in_logs`), plus `sampled`.
- `recordEval(outcome)` increments the counters; called per chat turn from the computed `evalOutcome`.
  PHI-free (booleans/counts only).

### Readiness probes (all non-critical → a failure degrades, never `not_ready`)
- **`document_storage`** — OpenEMR document storage reachability (uploaded documents live in OpenEMR;
  probes the OpenEMR FHIR base). Registered always.
- **`vector_index`** — the in-memory guideline index built at startup (`ready` ⇔ the evidence
  retriever is wired). Registered when RAG is enabled.
- **`reranker`** — Cohere rerank API reachability. Registered when RAG is enabled (replaces the
  generic `cohere` probe name).

## Boundaries

- Deterministic + PHI-free; no new external service. The eval-regression alert uses a live
  pass-rate threshold (no persisted baseline needed at runtime); the authoritative >5%-regression
  gate remains the pre-push hook (`w2-eval-gate`).
- Non-critical W2 probes degrade the service (chart answers keep working) rather than taking it down
  (`W2_ARCHITECTURE §9`).

## Acceptance criteria

1. `/alerts` lists `high_error_rate`, `high_latency_p95`, `tool_failure_rate`,
   `verification_fail_rate`, `extraction_failure_rate`, `rag_retrieval_latency`,
   `supervisor_hop_cap_rate`, `eval_regression_detection` — all by name, with status.
2. `eval_regression_detection` fires when a category pass rate falls below threshold; unit-tested.
3. `recordEval` populates the `eval` sub-snapshot; unit-tested.
4. `/ready` lists `document_storage`, `vector_index`, `reranker` by name (when applicable), each
   non-critical.
5. `docs/oncall.md` documents each alert's response action + the new probes. Existing tests green.

## Open questions

None.
