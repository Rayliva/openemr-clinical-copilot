/**
 * A minimal circuit breaker for an outbound dependency (W2 SLO resilience). Wrapping the Cohere
 * rerank call in this means that once the reranker fails repeatedly (e.g. a trial-key rate-limit
 * burst), the breaker OPENS and subsequent calls fail fast — the graph degrades to the fused,
 * unreranked order immediately instead of paying a per-request timeout to a service that is down.
 * After a cooldown it half-opens (one trial call); a success closes it, a failure re-opens it.
 *
 * Pure + deterministic: the clock is injected (`now`), so the state machine is unit-testable without
 * real time. The breaker itself never swallows the underlying error — it rethrows so the caller's
 * existing degrade path (`rerankEvidence` try/catch) runs unchanged (`error-handling-and-logging`).
 */

/** Thrown when a call is attempted while the circuit is open (the dependency is presumed down). */
export class CircuitOpenError extends Error {
  constructor(message = "circuit open") {
    super(message);
    this.name = "CircuitOpenError";
  }
}

export interface CircuitBreakerOptions {
  /** Consecutive failures that trip the breaker open. */
  readonly failureThreshold: number;
  /** How long the breaker stays open before a half-open trial (ms). */
  readonly cooldownMs: number;
  /** Injected monotonic clock (Unix ms); defaults to `Date.now` in production. */
  readonly now?: () => number;
}

export interface CircuitBreaker {
  /** Run `fn` through the breaker: fail-fast with {@link CircuitOpenError} while open, else execute. */
  run<T>(fn: () => Promise<T>): Promise<T>;
  /** Current state — "open" (failing fast) or "closed"/"half-open" (executing). */
  state(): "open" | "closed";
}

export function createCircuitBreaker(options: CircuitBreakerOptions): CircuitBreaker {
  const now = options.now ?? ((): number => Date.now());
  let failures = 0;
  let openUntil = 0;

  const isOpen = (): boolean => now() < openUntil;

  return {
    state: () => (isOpen() ? "open" : "closed"),
    async run<T>(fn: () => Promise<T>): Promise<T> {
      if (isOpen()) {
        throw new CircuitOpenError();
      }
      try {
        const result = await fn();
        failures = 0; // a success (incl. a half-open trial) closes the circuit
        return result;
      } catch (error) {
        failures += 1;
        if (failures >= options.failureThreshold) {
          // Trip open. `failures` is NOT reset, so a single failure of the post-cooldown half-open
          // trial (failures already ≥ threshold) re-opens immediately.
          openUntil = now() + options.cooldownMs;
        }
        throw error;
      }
    },
  };
}
