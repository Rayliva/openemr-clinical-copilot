import { createHttpReadinessCheck, type FetchFn } from "../readiness/httpCheck.js";
import type { ReadinessCheckFn } from "../readiness/registry.js";

const ANTHROPIC_VERSION = "2023-06-01";

export interface AnthropicReadinessOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetchFn?: FetchFn;
  readonly timeoutMs?: number;
}

/**
 * Readiness check for the LLM provider. Probes Anthropic's `GET /v1/models`,
 * which validates the API key without spending tokens.
 */
export function createAnthropicReadinessCheck(options: AnthropicReadinessOptions): ReadinessCheckFn {
  const baseUrl = (options.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
  return createHttpReadinessCheck({
    url: `${baseUrl}/v1/models`,
    headers: { "x-api-key": options.apiKey, "anthropic-version": ANTHROPIC_VERSION },
    timeoutMessage: "anthropic probe timed out",
    ...(options.fetchFn !== undefined ? { fetchFn: options.fetchFn } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  });
}
