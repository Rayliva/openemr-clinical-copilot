/**
 * Alert rules evaluated against a MetricsSnapshot (E7). Deterministic, no I/O — the
 * `/alerts` route and any operator poller derive the firing set from these outcomes.
 *
 * Thresholds are grounded in the E9 load test (`loadtest/results/`): healthy is 10
 * concurrent (0% error, p95 ~10s); the overload cliff is 50 concurrent (73% error, p95
 * ~32s, all OpenEMR FHIR 500s). Carries no PHI: rule names and numbers only.
 *
 * Spec: docs/specs/alerts-and-oncall.md
 */

import type { MetricsSnapshot } from "./registry.js";

export type AlertStatus = "ok" | "warning" | "critical" | "insufficient_data";

export interface AlertOutcome {
  readonly name: string;
  readonly status: AlertStatus;
  /** The observed value the rule read, or null when there was nothing to measure. */
  readonly value: number | null;
  /** The nearest threshold the value is compared against (warning band), for context. */
  readonly threshold: number;
  /** Human-readable, PHI-free: what the rule means and (when firing) the specifics. */
  readonly description: string;
}

export interface AlertConfig {
  /** Minimum requests in the window before rate rules evaluate (anti-flap). */
  readonly minRequests?: number;
}

const DEFAULT_MIN_REQUESTS = 20;

/** Classify a "higher is worse" value against warning/critical thresholds. */
function classify(value: number, warning: number, critical: number): AlertStatus {
  if (value >= critical) {
    return "critical";
  }
  if (value >= warning) {
    return "warning";
  }
  return "ok";
}

function evaluateErrorRate(snapshot: MetricsSnapshot, minRequests: number): AlertOutcome {
  const warning = 0.1;
  const description =
    "Fraction of turns that errored outright. Sustained elevation usually means a" +
    " dependency (OpenEMR, Anthropic) is failing — check /dashboard tool rows and logs.";
  if (snapshot.requestsTotal < minRequests) {
    return { name: "high_error_rate", status: "insufficient_data", value: snapshot.errorRate, threshold: warning, description };
  }
  return {
    name: "high_error_rate",
    status: classify(snapshot.errorRate, warning, 0.5),
    value: snapshot.errorRate,
    threshold: warning,
    description,
  };
}

function evaluateLatencyP95(snapshot: MetricsSnapshot): AlertOutcome {
  const warning = 15000;
  const description =
    "p95 turn latency (ms). Healthy grounding-on p95 is ~10s; the 50-concurrent" +
    " overload cliff hit ~32s. Elevated p95 points to OpenEMR saturation or LLM slowness.";
  if (snapshot.latencyMs.p95 === null) {
    return { name: "high_latency_p95", status: "insufficient_data", value: null, threshold: warning, description };
  }
  return {
    name: "high_latency_p95",
    status: classify(snapshot.latencyMs.p95, warning, 30000),
    value: snapshot.latencyMs.p95,
    threshold: warning,
    description,
  };
}

function evaluateToolFailureRate(snapshot: MetricsSnapshot, minRequests: number): AlertOutcome {
  const warning = 0.1;
  const baseDescription =
    "Worst per-tool failure rate. The E9 overload failures were all OpenEMR FHIR 500s," +
    " so this rises before whole turns fail — the FHIR-saturation early warning.";
  if (snapshot.requestsTotal < minRequests) {
    return { name: "tool_failure_rate", status: "insufficient_data", value: null, threshold: warning, description: baseDescription };
  }
  let worstTool: string | null = null;
  let worstRate = 0;
  for (const [name, tool] of Object.entries(snapshot.tools)) {
    if (tool === undefined || tool.callsTotal === 0) {
      continue;
    }
    const rate = tool.failuresTotal / tool.callsTotal;
    if (rate > worstRate) {
      worstRate = rate;
      worstTool = name;
    }
  }
  const description =
    worstTool === null ? baseDescription : `${baseDescription} Worst: ${worstTool} at ${(worstRate * 100).toFixed(0)}%.`;
  return {
    name: "tool_failure_rate",
    status: classify(worstRate, warning, 0.3),
    value: worstRate,
    threshold: warning,
    description,
  };
}

function evaluateVerificationFailRate(snapshot: MetricsSnapshot, minRequests: number): AlertOutcome {
  const warning = 0.2;
  const total = snapshot.verificationPassTotal + snapshot.verificationFailTotal;
  const description =
    "Fraction of turns that ended unverified (a claim dropped by the grounding gate). A" +
    " spike is a trust signal — model drift, a prompt regression, or bad chart data.";
  if (total < minRequests) {
    return { name: "verification_fail_rate", status: "insufficient_data", value: total === 0 ? null : snapshot.verificationFailTotal / total, threshold: warning, description };
  }
  const rate = snapshot.verificationFailTotal / total;
  return {
    name: "verification_fail_rate",
    status: classify(rate, warning, 0.5),
    value: rate,
    threshold: warning,
    description,
  };
}

// --- W2 rules (docs/specs/w2-observability.md §2). Same classify + volume-gate shape as W1. ---

/** Minimum extractions before the extraction-failure rule evaluates (anti-flap). */
const MIN_EXTRACTIONS = 5;
/** Minimum routed turns before the hop-cap rule evaluates. */
const MIN_ROUTED_TURNS = 10;
/** Minimum per-category eval samples before the eval-regression rule evaluates (anti-flap). */
const MIN_EVAL_SAMPLES = 10;

function evaluateExtractionFailureRate(snapshot: MetricsSnapshot): AlertOutcome {
  const warning = 0.2;
  const { extractionOk, extractionDegraded } = snapshot.ingestion;
  const total = extractionOk + extractionDegraded;
  const description =
    "Fraction of document extractions that degraded (schema-invalid or unreadable). Sustained" +
    " elevation is usually a VLM model/prompt regression or a schema drift — the doc stays pending," +
    " never a partial write. Response: docs/oncall.md → extraction failure rate.";
  if (total < MIN_EXTRACTIONS) {
    return { name: "extraction_failure_rate", status: "insufficient_data", value: total === 0 ? null : extractionDegraded / total, threshold: warning, description };
  }
  const rate = extractionDegraded / total;
  return {
    name: "extraction_failure_rate",
    status: classify(rate, warning, 0.5),
    value: rate,
    threshold: warning,
    description,
  };
}

function evaluateRagRetrievalLatencyP95(snapshot: MetricsSnapshot): AlertOutcome {
  const warning = 4000;
  const description =
    "p95 of the guideline retrieve+rerank round-trip (ms). The Cohere embed/rerank hop is the usual" +
    " cause; the circuit-breaker + 'unreranked' fallback keep answers flowing. Response:" +
    " docs/oncall.md → RAG retrieval latency.";
  if (snapshot.retrieval.latencyMs.p95 === null) {
    return { name: "rag_retrieval_latency", status: "insufficient_data", value: null, threshold: warning, description };
  }
  return {
    name: "rag_retrieval_latency",
    status: classify(snapshot.retrieval.latencyMs.p95, warning, 8000),
    value: snapshot.retrieval.latencyMs.p95,
    threshold: warning,
    description,
  };
}

function evaluateSupervisorHopCapRate(snapshot: MetricsSnapshot): AlertOutcome {
  const warning = 0.2;
  const { turnsRouted, hopCapHits } = snapshot.supervisor;
  const description =
    "Fraction of routed turns where the supervisor hit its hop cap (the loop backstop fired). A" +
    " rising rate means the router is looping instead of converging — check the routing rationale in" +
    " the traces. Response: docs/oncall.md → supervisor routing.";
  if (turnsRouted < MIN_ROUTED_TURNS) {
    return { name: "supervisor_hop_cap_rate", status: "insufficient_data", value: turnsRouted === 0 ? null : hopCapHits / turnsRouted, threshold: warning, description };
  }
  const rate = hopCapHits / turnsRouted;
  return {
    name: "supervisor_hop_cap_rate",
    status: classify(rate, warning, 0.5),
    value: rate,
    threshold: warning,
    description,
  };
}

/**
 * Eval-regression alert: fires when any deterministic per-encounter eval category's live failure
 * rate exceeds 5% — the RUNTIME analog of the pre-push gate's ">5% regression" rule (the gate stays
 * the authoritative offline check). Warning at >5% failing, critical at >10%. Volume-gated per
 * category. PHI-free (category names + rates only).
 */
function evaluateEvalRegression(snapshot: MetricsSnapshot): AlertOutcome {
  const warning = 0.05;
  const description =
    "Worst per-category failure rate of the deterministic per-encounter eval checks (schema_valid," +
    " citation_present, grounding_ok, no_phi_in_logs). >5% failing in any category is the runtime" +
    " analog of the pre-push eval gate's >5%-regression rule. Response: docs/oncall.md → eval regression detection.";
  let worstCategory: string | null = null;
  let worstFailRate = 0;
  let evaluatedAny = false;
  for (const [name, category] of Object.entries(snapshot.eval.categories)) {
    if (category === undefined || category.total < MIN_EVAL_SAMPLES) {
      continue;
    }
    evaluatedAny = true;
    const failRate = (category.total - category.pass) / category.total;
    if (failRate > worstFailRate) {
      worstFailRate = failRate;
      worstCategory = name;
    }
  }
  if (!evaluatedAny) {
    return { name: "eval_regression_detection", status: "insufficient_data", value: null, threshold: warning, description };
  }
  const detail =
    worstCategory === null ? description : `${description} Worst: ${worstCategory} at ${(worstFailRate * 100).toFixed(0)}% failing.`;
  return {
    name: "eval_regression_detection",
    status: classify(worstFailRate, warning, 0.1),
    value: worstFailRate,
    threshold: warning,
    description: detail,
  };
}

/**
 * Evaluate every alert rule against a snapshot. Returns one outcome per rule (order is stable: W1
 * error rate, latency, tool failures, verification; then W2 extraction failure, RAG latency,
 * supervisor hop cap, eval regression). The firing set is the subset with status `warning`/`critical`.
 */
export function evaluateAlerts(snapshot: MetricsSnapshot, config: AlertConfig = {}): AlertOutcome[] {
  const minRequests = config.minRequests ?? DEFAULT_MIN_REQUESTS;
  return [
    evaluateErrorRate(snapshot, minRequests),
    evaluateLatencyP95(snapshot),
    evaluateToolFailureRate(snapshot, minRequests),
    evaluateVerificationFailRate(snapshot, minRequests),
    evaluateExtractionFailureRate(snapshot),
    evaluateRagRetrievalLatencyP95(snapshot),
    evaluateSupervisorHopCapRate(snapshot),
    evaluateEvalRegression(snapshot),
  ];
}

/** The firing subset (warning or critical), most severe first. */
export function firingAlerts(outcomes: readonly AlertOutcome[]): AlertOutcome[] {
  const rank = (s: AlertStatus): number => (s === "critical" ? 0 : s === "warning" ? 1 : 2);
  return outcomes.filter((o) => o.status === "warning" || o.status === "critical").sort((a, b) => rank(a.status) - rank(b.status));
}
