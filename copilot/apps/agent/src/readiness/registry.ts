/**
 * Readiness-check registry for the `/ready` endpoint.
 *
 * Pure, framework-agnostic: holds a set of named checks and runs them. It starts
 * empty and gains real checks (Redis, OpenEMR API, Claude, Langfuse) as each
 * dependency is wired in. This keeps `/ready` an honest dependency probe rather
 * than a bare 200 (ARCHITECTURE.md §6).
 */

export type ReadinessStatus = "ok" | "error";

/**
 * The overall readiness of the service (W2, non-binary):
 * - `ready` — every check passed.
 * - `degraded` — all **critical** checks passed, but a **non-critical** dependency (e.g. the RAG /
 *   reranker) is down. The service is still up: chart answers keep working (`W2_ARCHITECTURE §9`).
 * - `not_ready` — a **critical** dependency failed; the service cannot serve its core function.
 */
export type OverallStatus = "ready" | "degraded" | "not_ready";

export interface ReadinessCheckResult {
  readonly name: string;
  readonly status: ReadinessStatus;
}

/** A single dependency check: returns true when healthy. May throw on failure. */
export type ReadinessCheckFn = () => boolean | Promise<boolean>;

export interface ReadinessCheckOptions {
  /**
   * Whether a failure of this check makes the whole service `not_ready` (default `true`). A
   * non-critical check that fails degrades the service to `degraded` instead — the core still serves.
   */
  readonly critical?: boolean;
}

export interface ReadinessReport {
  /** Binary up/down for a load balancer: `true` for `ready` OR `degraded`, `false` for `not_ready`. */
  readonly ready: boolean;
  /** The three-state overall status. */
  readonly status: OverallStatus;
  readonly checks: readonly ReadinessCheckResult[];
}

interface RegisteredCheck {
  readonly name: string;
  readonly fn: ReadinessCheckFn;
  readonly critical: boolean;
}

export class ReadinessRegistry {
  readonly #checks: RegisteredCheck[] = [];

  /**
   * Register a named dependency check. Returns `this` for chaining. `critical` defaults to true;
   * pass `{ critical: false }` for a dependency whose failure should degrade (not down) the service.
   */
  register(name: string, fn: ReadinessCheckFn, options: ReadinessCheckOptions = {}): this {
    this.#checks.push({ name, fn, critical: options.critical ?? true });
    return this;
  }

  /**
   * Run every registered check concurrently.
   *
   * A check that throws or returns false is reported as `error`. The raw error is
   * never placed in the result (it must not leak to the client — see the
   * error-handling-and-logging rule); pass `onError` to log the detail instead.
   */
  async runAll(
    onError?: (name: string, error: unknown) => void,
  ): Promise<ReadinessReport> {
    const results = await Promise.all(
      this.#checks.map(
        async (check): Promise<{ result: ReadinessCheckResult; critical: boolean }> => {
          try {
            const ok = await check.fn();
            return { result: { name: check.name, status: ok ? "ok" : "error" }, critical: check.critical };
          } catch (error) {
            onError?.(check.name, error);
            return { result: { name: check.name, status: "error" }, critical: check.critical };
          }
        },
      ),
    );

    const criticalFailed = results.some((r) => r.critical && r.result.status === "error");
    const nonCriticalFailed = results.some((r) => !r.critical && r.result.status === "error");
    const status: OverallStatus = criticalFailed ? "not_ready" : nonCriticalFailed ? "degraded" : "ready";

    return { ready: status !== "not_ready", status, checks: results.map((r) => r.result) };
  }
}
