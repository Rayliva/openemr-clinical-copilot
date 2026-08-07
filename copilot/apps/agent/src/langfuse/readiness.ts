import { createHttpReadinessCheck, type FetchFn } from "../readiness/httpCheck.js";
import type { ReadinessCheckFn } from "../readiness/registry.js";

export interface LangfuseReadinessOptions {
  readonly baseUrl: string;
  readonly fetchFn?: FetchFn;
  readonly timeoutMs?: number;
}

/** Readiness check for the self-hosted Langfuse (its public health endpoint). */
export function createLangfuseReadinessCheck(options: LangfuseReadinessOptions): ReadinessCheckFn {
  return createHttpReadinessCheck({
    url: `${options.baseUrl.replace(/\/$/, "")}/api/public/health`,
    timeoutMessage: "langfuse probe timed out",
    ...(options.fetchFn !== undefined ? { fetchFn: options.fetchFn } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  });
}
