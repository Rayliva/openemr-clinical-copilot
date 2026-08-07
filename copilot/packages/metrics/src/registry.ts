/**
 * In-process metrics registry: the *live operational window* for the agent.
 *
 * This is deliberately not durable. Langfuse persists the per-request traces and is
 * the historical record; this registry answers only "what is happening right now",
 * which is the question an alert evaluates. A process restart resetting it is correct.
 *
 * Contains no PHI: tool names, counts, and latencies only — never a pid, correlation
 * id, or patient datum (`.claude/rules/phi-and-secrets.md`).
 *
 * Spec: docs/specs/observability-dashboard.md
 */

/** Nearest-rank percentile. `sorted` must be ascending and non-empty. */
function percentile(sorted: readonly number[], fraction: number): number {
  const rank = Math.ceil(fraction * sorted.length);
  const index = Math.min(Math.max(rank, 1), sorted.length) - 1;
  return sorted[index] as number;
}

/** A bounded ring of the most recent observations. Oldest evicted first. */
class Window {
  readonly #values: number[] = [];

  constructor(private readonly capacity: number) {}

  add(value: number): void {
    this.#values.push(value);
    if (this.#values.length > this.capacity) {
      this.#values.shift();
    }
  }

  percentiles(): LatencySnapshot {
    if (this.#values.length === 0) {
      return { p50: null, p95: null };
    }
    const sorted = [...this.#values].sort((a, b) => a - b);
    return { p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) };
  }
}

export interface LatencySnapshot {
  readonly p50: number | null;
  readonly p95: number | null;
}

export interface ToolSnapshot {
  readonly callsTotal: number;
  readonly failuresTotal: number;
  readonly latencyMs: LatencySnapshot;
}

/** Per-doc-type extraction tally (W2 document ingestion). */
export interface DocTypeSnapshot {
  readonly total: number;
  readonly ok: number;
  readonly degraded: number;
}

/**
 * W2 document-ingestion signals. Recorded once per document actually extracted (a cache hit records
 * nothing — extract-once). Counts + latencies + doc types + field match states only, never a title
 * or a value (`phi-and-secrets`). Spec: docs/specs/w2-observability.md §1.1.
 */
export interface IngestionSnapshot {
  readonly documentsTotal: number;
  readonly byDocType: Readonly<Record<string, DocTypeSnapshot | undefined>>;
  readonly extractionOk: number;
  readonly extractionDegraded: number;
  /** Fields whose extracted value was located to a tight box (the confident path). */
  readonly fieldsLocated: number;
  /** Fields with no tight box → forced to physician review (approximate/unverified). */
  readonly fieldsForcedReview: number;
  /** Per-document extract-to-draft duration (machine time; the W2 SLO). */
  readonly extractionLatencyMs: LatencySnapshot;
}

/**
 * W2 guideline-RAG signals. Recorded once per retrieval query. Snippet counts (hits) and rerank
 * used-vs-degraded (the "unreranked" fallback) + round-trip latency. Spec §1.2.
 */
export interface RetrievalSnapshot {
  readonly queriesTotal: number;
  readonly snippetsTotal: number;
  /** Queries that returned nothing — a `retrieval.miss` (absence, never a negative finding). */
  readonly zeroHitQueries: number;
  readonly rerankUsed: number;
  readonly rerankDegraded: number;
  readonly latencyMs: LatencySnapshot;
}

/**
 * W2 supervisor routing signals. Recorded once per supervisor hop. Spec §1.3.
 */
export interface SupervisorSnapshot {
  /** Count of routing decisions per next-target (intake_extractor / evidence_retriever / ready). */
  readonly routes: Readonly<Record<string, number | undefined>>;
  /** Turns that reached a terminal (`ready`) decision through the supervisor. */
  readonly turnsRouted: number;
  /** Times the hop cap forced `ready` (the loop backstop fired). */
  readonly hopCapHits: number;
}

export interface EvalCategorySnapshot {
  readonly pass: number;
  readonly total: number;
}

export interface EvalSnapshot {
  /** Per-category pass/total for the deterministic per-encounter eval categories. */
  readonly categories: Readonly<Record<string, EvalCategorySnapshot | undefined>>;
  /** Turns for which a per-encounter eval outcome was recorded. */
  readonly sampled: number;
}

export interface MetricsSnapshot {
  readonly requestsTotal: number;
  readonly requestsFailed: number;
  /** Zero (not NaN) when no requests have been recorded. */
  readonly errorRate: number;
  readonly latencyMs: LatencySnapshot;
  readonly tools: Readonly<Record<string, ToolSnapshot | undefined>>;
  readonly verificationPassTotal: number;
  readonly verificationFailTotal: number;
  /** Total bounded regenerations run across turns (the grounding retry loop). */
  readonly retriesTotal: number;
  /**
   * True: the bounded regenerate-with-feedback that `verification-gate.md` prescribes
   * is implemented — the grounding node re-generates once on a failed grounding check
   * before degrading. `retriesTotal` at zero now honestly means "no retry has fired",
   * not "no retry path exists" (see docs/specs/grounding-judge.md).
   */
  readonly retryPathImplemented: boolean;
  readonly windowSize: number;
  /** W2 document-ingestion signals. */
  readonly ingestion: IngestionSnapshot;
  /** W2 guideline-RAG signals. */
  readonly retrieval: RetrievalSnapshot;
  /** W2 supervisor routing signals. */
  readonly supervisor: SupervisorSnapshot;
  /** W2 per-encounter eval-outcome signals (deterministic categories), backing eval-regression alerts. */
  readonly eval: EvalSnapshot;
}

export interface TurnObservation {
  readonly latencyMs: number;
  /** The turn errored outright. A degraded or unverified answer is NOT a failure. */
  readonly failed: boolean;
  readonly verdictOk: boolean;
}

export interface ToolObservation {
  readonly tool: string;
  readonly latencyMs: number;
  readonly failed: boolean;
}

export interface RetryObservation {
  /**
   * Which operation was retried (e.g. `"grounding"`). Recorded for call-site clarity
   * and future per-operation breakdown; today it sums into the scalar `retriesTotal`.
   */
  readonly operation: string;
  /** Regenerations performed this turn (0 is a no-op — nothing recorded). */
  readonly attempts: number;
}

/** One document's extraction outcome (W2). Recorded per extracted document, never per cache hit. */
export interface IngestionObservation {
  /** `"lab_pdf"` | `"intake_form"` | `"unknown"` — no title, no PHI. */
  readonly docType: string;
  readonly outcome: "ok" | "degraded";
  /** Fields located to a tight box. 0 for a degraded extraction. */
  readonly fieldsLocated: number;
  /** Fields with no tight box → forced review. 0 for a degraded extraction. */
  readonly fieldsForcedReview: number;
  /** Extract-to-draft duration for this document. */
  readonly latencyMs: number;
}

/** One retrieval query's outcome (W2). */
export interface RetrievalObservation {
  /** Snippets returned to the answer model (hits). 0 is a `retrieval.miss`. */
  readonly snippets: number;
  /** `"used"` = rerank ran; `"degraded"` = fell back to the fused pre-rerank top-N. */
  readonly rerank: "used" | "degraded";
  /** Retrieve+rerank round-trip duration. */
  readonly latencyMs: number;
}

/** One supervisor hop's routing decision (W2). */
export interface RoutingObservation {
  /** The next-target the supervisor chose (`intake_extractor` / `evidence_retriever` / `ready`). */
  readonly target: string;
  /** True when this hop was the terminal (`ready`) decision — one per routed turn. */
  readonly terminal: boolean;
  /** True when the hop cap forced this `ready` (the loop backstop fired). */
  readonly hopCapped: boolean;
}

export interface MetricsRegistry {
  recordTurn(observation: TurnObservation): void;
  recordToolCall(observation: ToolObservation): void;
  recordRetry(observation: RetryObservation): void;
  /** W2: record one document's extraction outcome (ingestion service). */
  recordIngestion(observation: IngestionObservation): void;
  /** W2: record one retrieval query's outcome (evidence-retriever worker). */
  recordRetrieval(observation: RetrievalObservation): void;
  /** W2: record one supervisor routing decision (supervisor node). */
  recordRouting(observation: RoutingObservation): void;
  /**
   * W2: record one encounter's deterministic eval outcome (category → passed). Feeds the
   * `eval_regression_detection` alert. PHI-free (booleans only).
   */
  recordEval(outcome: Readonly<Record<string, boolean>>): void;
  snapshot(): MetricsSnapshot;
}

export interface MetricsRegistryOptions {
  /** Observations retained for percentile computation. Counters stay monotonic. */
  readonly windowSize?: number;
}

const DEFAULT_WINDOW_SIZE = 1000;

interface ToolState {
  callsTotal: number;
  failuresTotal: number;
  readonly latency: Window;
}

interface DocTypeState {
  total: number;
  ok: number;
  degraded: number;
}

export function createMetricsRegistry(options: MetricsRegistryOptions = {}): MetricsRegistry {
  const windowSize = options.windowSize ?? DEFAULT_WINDOW_SIZE;

  let requestsTotal = 0;
  let requestsFailed = 0;
  let verificationPassTotal = 0;
  let verificationFailTotal = 0;
  let retriesTotal = 0;
  const turnLatency = new Window(windowSize);
  const tools = new Map<string, ToolState>();

  // W2 ingestion state.
  let documentsTotal = 0;
  let extractionOk = 0;
  let extractionDegraded = 0;
  let fieldsLocated = 0;
  let fieldsForcedReview = 0;
  const byDocType = new Map<string, DocTypeState>();
  const extractionLatency = new Window(windowSize);

  // W2 retrieval state.
  let queriesTotal = 0;
  let snippetsTotal = 0;
  let zeroHitQueries = 0;
  let rerankUsed = 0;
  let rerankDegraded = 0;
  const retrievalLatency = new Window(windowSize);

  // W2 supervisor state.
  const routes = new Map<string, number>();
  let turnsRouted = 0;
  let hopCapHits = 0;

  // W2 per-encounter eval-outcome state (per-category pass/total).
  const evalCategories = new Map<string, { pass: number; total: number }>();
  let evalSampled = 0;

  return {
    recordTurn({ latencyMs, failed, verdictOk }): void {
      requestsTotal += 1;
      if (failed) {
        requestsFailed += 1;
      }
      turnLatency.add(latencyMs);
      if (verdictOk) {
        verificationPassTotal += 1;
      } else {
        verificationFailTotal += 1;
      }
    },

    recordToolCall({ tool, latencyMs, failed }): void {
      let state = tools.get(tool);
      if (state === undefined) {
        state = { callsTotal: 0, failuresTotal: 0, latency: new Window(windowSize) };
        tools.set(tool, state);
      }
      state.callsTotal += 1;
      if (failed) {
        state.failuresTotal += 1;
      }
      state.latency.add(latencyMs);
    },

    recordRetry({ attempts }): void {
      if (attempts > 0) {
        retriesTotal += attempts;
      }
    },

    recordIngestion({ docType, outcome, fieldsLocated: located, fieldsForcedReview: forced, latencyMs }): void {
      documentsTotal += 1;
      let state = byDocType.get(docType);
      if (state === undefined) {
        state = { total: 0, ok: 0, degraded: 0 };
        byDocType.set(docType, state);
      }
      state.total += 1;
      if (outcome === "ok") {
        state.ok += 1;
        extractionOk += 1;
      } else {
        state.degraded += 1;
        extractionDegraded += 1;
      }
      fieldsLocated += located;
      fieldsForcedReview += forced;
      extractionLatency.add(latencyMs);
    },

    recordRetrieval({ snippets, rerank, latencyMs }): void {
      queriesTotal += 1;
      snippetsTotal += snippets;
      if (snippets === 0) {
        zeroHitQueries += 1;
      }
      if (rerank === "used") {
        rerankUsed += 1;
      } else {
        rerankDegraded += 1;
      }
      retrievalLatency.add(latencyMs);
    },

    recordRouting({ target, terminal, hopCapped }): void {
      routes.set(target, (routes.get(target) ?? 0) + 1);
      if (terminal) {
        turnsRouted += 1;
      }
      if (hopCapped) {
        hopCapHits += 1;
      }
    },

    recordEval(outcome): void {
      evalSampled += 1;
      for (const [category, passed] of Object.entries(outcome)) {
        let state = evalCategories.get(category);
        if (state === undefined) {
          state = { pass: 0, total: 0 };
          evalCategories.set(category, state);
        }
        state.total += 1;
        if (passed) {
          state.pass += 1;
        }
      }
    },

    snapshot(): MetricsSnapshot {
      const toolSnapshots: Record<string, ToolSnapshot> = {};
      for (const [name, state] of tools) {
        toolSnapshots[name] = {
          callsTotal: state.callsTotal,
          failuresTotal: state.failuresTotal,
          latencyMs: state.latency.percentiles(),
        };
      }

      const docTypeSnapshots: Record<string, DocTypeSnapshot> = {};
      for (const [name, state] of byDocType) {
        docTypeSnapshots[name] = { total: state.total, ok: state.ok, degraded: state.degraded };
      }

      const routeSnapshots: Record<string, number> = {};
      for (const [name, count] of routes) {
        routeSnapshots[name] = count;
      }

      const evalCategorySnapshots: Record<string, EvalCategorySnapshot> = {};
      for (const [name, state] of evalCategories) {
        evalCategorySnapshots[name] = { pass: state.pass, total: state.total };
      }

      return {
        requestsTotal,
        requestsFailed,
        errorRate: requestsTotal === 0 ? 0 : requestsFailed / requestsTotal,
        latencyMs: turnLatency.percentiles(),
        tools: toolSnapshots,
        verificationPassTotal,
        verificationFailTotal,
        retriesTotal,
        retryPathImplemented: true,
        windowSize,
        ingestion: {
          documentsTotal,
          byDocType: docTypeSnapshots,
          extractionOk,
          extractionDegraded,
          fieldsLocated,
          fieldsForcedReview,
          extractionLatencyMs: extractionLatency.percentiles(),
        },
        retrieval: {
          queriesTotal,
          snippetsTotal,
          zeroHitQueries,
          rerankUsed,
          rerankDegraded,
          latencyMs: retrievalLatency.percentiles(),
        },
        supervisor: {
          routes: routeSnapshots,
          turnsRouted,
          hopCapHits,
        },
        eval: {
          categories: evalCategorySnapshots,
          sampled: evalSampled,
        },
      };
    },
  };
}
