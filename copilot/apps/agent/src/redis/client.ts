import { Redis } from "ioredis";

/**
 * Create a Redis client that connects eagerly in the background and retries a
 * request at most once, so a command rejects quickly rather than hanging. The
 * readiness check additionally bounds each PING with a timeout. The caller must
 * attach an `error` listener (ioredis emits `error` events) — see server.ts.
 */
export function createRedisClient(url: string): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: 1,
  });
}
