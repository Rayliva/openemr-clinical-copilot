import type { FetchFn } from "../oauth/token.js";

/** Raised when a FHIR request fails. Carries no raw server text upward. */
export class OpenEmrFhirError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "OpenEmrFhirError";
  }
}

export interface OpenEmrFhirClientOptions {
  readonly baseUrl: string;
  /** Supplies a bearer token — typically `OpenEmrTokenClient.getAccessToken`. */
  readonly getAccessToken: () => Promise<string>;
  readonly fetchFn?: FetchFn;
}

/**
 * Authenticated reader for OpenEMR's FHIR R4 API. Returns raw resource JSON as
 * `unknown`; callers (tools / snapshot assembly) validate the specific shape with
 * Zod and attach provenance.
 */
export class OpenEmrFhirClient {
  readonly #base: string;
  readonly #getToken: () => Promise<string>;
  readonly #fetchFn: FetchFn;

  constructor(options: OpenEmrFhirClientOptions) {
    this.#base = `${options.baseUrl.replace(/\/$/, "")}/apis/default/fhir`;
    this.#getToken = options.getAccessToken;
    this.#fetchFn = options.fetchFn ?? fetch;
  }

  read(resourceType: string, id: string): Promise<unknown> {
    return this.#get(`${this.#base}/${resourceType}/${encodeURIComponent(id)}`);
  }

  search(resourceType: string, params: Record<string, string>): Promise<unknown> {
    const query = new URLSearchParams(params).toString();
    const url = query ? `${this.#base}/${resourceType}?${query}` : `${this.#base}/${resourceType}`;
    return this.#get(url);
  }

  /**
   * Fetch a Binary resource's raw bytes (an uploaded document). OpenEMR returns the raw file body
   * (e.g. `application/pdf`), not FHIR Binary JSON, so this returns bytes rather than parsed JSON.
   * Requires the `system/Binary.read` scope. Errors carry no server text (PHI-safe).
   */
  async readBinary(id: string): Promise<Uint8Array> {
    const token = await this.#getToken();
    const url = `${this.#base}/Binary/${encodeURIComponent(id)}`;

    let response: Response;
    try {
      response = await this.#fetchFn(url, {
        method: "GET",
        headers: { authorization: `Bearer ${token}`, accept: "application/octet-stream, application/pdf, */*" },
      });
    } catch (error) {
      throw new OpenEmrFhirError("binary request failed", { cause: error });
    }

    if (!response.ok) {
      throw new OpenEmrFhirError(`binary request failed with status ${response.status}`);
    }

    const bytes = await response.arrayBuffer();
    return new Uint8Array(bytes);
  }

  async #get(url: string): Promise<unknown> {
    const token = await this.#getToken();

    let response: Response;
    try {
      response = await this.#fetchFn(url, {
        method: "GET",
        headers: { authorization: `Bearer ${token}`, accept: "application/fhir+json" },
      });
    } catch (error) {
      throw new OpenEmrFhirError("fhir request failed", { cause: error });
    }

    if (!response.ok) {
      throw new OpenEmrFhirError(`fhir request failed with status ${response.status}`);
    }

    try {
      return await response.json();
    } catch (error) {
      throw new OpenEmrFhirError("fhir response was not valid JSON", { cause: error });
    }
  }
}
