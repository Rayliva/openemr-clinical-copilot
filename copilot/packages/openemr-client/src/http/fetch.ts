import { Agent, fetch as undiciFetch } from "undici";
import type { FetchFn } from "../oauth/token.js";

export interface NodeFetchOptions {
  /**
   * DEV ONLY: accept self-signed TLS certificates (e.g. the local OpenEMR served
   * over https with a self-signed cert). Must never be enabled in production — a
   * real certificate is used there. Scoped to this fetch's requests only, not the
   * whole process.
   */
  readonly insecureTls?: boolean;
}

/**
 * Build the fetch used for OpenEMR calls. Defaults to the global fetch; when
 * `insecureTls` is set, routes through an undici dispatcher that skips certificate
 * verification for these requests only (dev against self-signed OpenEMR).
 */
export function createNodeFetch(options: NodeFetchOptions = {}): FetchFn {
  if (!options.insecureTls) {
    return fetch;
  }
  const dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
  return (url, init) =>
    undiciFetch(url, {
      ...(init ?? {}),
      dispatcher,
    } as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>;
}
