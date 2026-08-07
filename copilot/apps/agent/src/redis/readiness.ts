import type { ReadinessCheckFn } from "../readiness/registry.js";
import { withTimeout } from "../util/timeout.js";

/** The slice of a Redis client the readiness check needs (keeps it unit-testable). */
export interface Pingable {
  ping(): Promise<string>;
}

/** Default upper bound on a readiness PING, so `/ready` fast-fails when Redis is down. */
export const DEFAULT_REDIS_PING_TIMEOUT_MS = 1000;

/**
 * A readiness check that is `ok` only when Redis answers `PING` with `PONG`
 * within `timeoutMs`. A wrong reply is `false`; a timeout or thrown error
 * propagates to the registry, which reports it as `error` (detail logged, never
 * leaked).
 */
export function createRedisReadinessCheck(
  redis: Pingable,
  timeoutMs: number = DEFAULT_REDIS_PING_TIMEOUT_MS,
): ReadinessCheckFn {
  return async () => {
    const reply = await withTimeout(redis.ping(), timeoutMs, "redis ping timed out");
    return reply === "PONG";
  };
}
