import { withTimeout } from "../util/timeout.js";
import type { ReadinessCheckFn } from "./registry.js";

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface HttpReadinessOptions {
  readonly url: string;
  readonly headers?: Record<string, string>;
  readonly fetchFn?: FetchFn;
  readonly timeoutMs?: number;
  readonly timeoutMessage?: string;
}

const DEFAULT_TIMEOUT_MS = 3000;

/**
 * A readiness check that GETs `url` and is `ok` on a 2xx response within a
 * timeout. Shared by the OpenEMR / Langfuse / Anthropic probes so `/ready`'s
 * dependency checks behave identically.
 */
export function createHttpReadinessCheck(options: HttpReadinessOptions): ReadinessCheckFn {
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async () => {
    const controller = new AbortController();
    const request = fetchFn(options.url, {
      method: "GET",
      signal: controller.signal,
      ...(options.headers !== undefined ? { headers: options.headers } : {}),
    });
    try {
      const response = await withTimeout(
        request,
        timeoutMs,
        options.timeoutMessage ?? "readiness probe timed out",
      );
      return response.ok;
    } catch (error) {
      controller.abort();
      throw error;
    }
  };
}
