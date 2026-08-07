import type { ReadinessCheckFn } from "../readiness/registry.js";
import { withTimeout } from "../util/timeout.js";

/** Injectable fetch (defaults to the global) so the check is unit-testable. */
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Default upper bound on the OpenEMR probe. Generous because dev-container
 * endpoints are slow (~3–6s on the Windows bind-mount / dev-mode PHP); tighten in
 * production via OPENEMR_PROBE_TIMEOUT_MS.
 */
export const DEFAULT_OPENEMR_PROBE_TIMEOUT_MS = 8000;

/**
 * The public OIDC discovery document. Validates the OAuth token surface the read
 * path needs first, and is faster than the FHIR CapabilityStatement (~6–7s).
 */
const PROBE_PATH = "/oauth2/default/.well-known/openid-configuration";

export interface OpenEmrReadinessOptions {
  readonly baseUrl: string;
  readonly fetchFn?: FetchFn;
  readonly timeoutMs?: number;
}

/**
 * A readiness check that is `ok` only when OpenEMR's FHIR CapabilityStatement
 * responds 2xx within `timeoutMs`. Non-2xx is `false`; a timeout or network
 * error propagates to the registry, which reports it as `error`.
 */
export function createOpenEmrReadinessCheck(options: OpenEmrReadinessOptions): ReadinessCheckFn {
  const {
    baseUrl,
    fetchFn = fetch,
    timeoutMs = DEFAULT_OPENEMR_PROBE_TIMEOUT_MS,
  } = options;
  const url = `${baseUrl.replace(/\/$/, "")}${PROBE_PATH}`;

  return async () => {
    const controller = new AbortController();
    const probe = fetchFn(url, { signal: controller.signal });
    try {
      const response = await withTimeout(probe, timeoutMs, "openemr probe timed out");
      return response.ok;
    } catch (error) {
      controller.abort();
      throw error;
    }
  };
}
