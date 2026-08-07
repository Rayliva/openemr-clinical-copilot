import { z } from "zod";
import { createClientAssertion, type SigningKey } from "./assertion.js";

/** Injectable fetch (defaults to the global) so the client is unit-testable. */
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string(),
  expires_in: z.number(),
  scope: z.string().optional(),
});

/** Raised when a token cannot be obtained. Carries no raw server text upward. */
export class OpenEmrAuthError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "OpenEmrAuthError";
  }
}

export interface OpenEmrTokenClientOptions {
  readonly baseUrl: string;
  readonly clientId: string;
  readonly privateKey: SigningKey;
  readonly scope: string;
  readonly kid?: string;
  readonly fetchFn?: FetchFn;
  readonly now?: () => Date;
  /** Re-fetch when fewer than this many seconds of token life remain. */
  readonly expirySkewSeconds?: number;
}

interface CachedToken {
  readonly accessToken: string;
  readonly expiresAt: number;
}

/**
 * Obtains OpenEMR access tokens via the SMART backend-services flow
 * (client_credentials + private_key_jwt) and caches them in memory. Tokens are
 * short-lived (~60s) with no refresh, so a fresh one is fetched as expiry nears.
 */
export class OpenEmrTokenClient {
  #cached: CachedToken | undefined;
  readonly #tokenEndpoint: string;
  readonly #fetchFn: FetchFn;
  readonly #now: () => Date;
  readonly #skew: number;

  constructor(private readonly options: OpenEmrTokenClientOptions) {
    this.#tokenEndpoint = `${options.baseUrl.replace(/\/$/, "")}/oauth2/default/token`;
    this.#fetchFn = options.fetchFn ?? fetch;
    this.#now = options.now ?? (() => new Date());
    this.#skew = options.expirySkewSeconds ?? 10;
  }

  async getAccessToken(): Promise<string> {
    const nowSec = Math.floor(this.#now().getTime() / 1000);
    const cached = this.#cached;
    if (cached && cached.expiresAt - nowSec > this.#skew) {
      return cached.accessToken;
    }
    return this.#requestToken(nowSec);
  }

  async #requestToken(nowSec: number): Promise<string> {
    const assertion = await createClientAssertion({
      clientId: this.options.clientId,
      tokenEndpoint: this.#tokenEndpoint,
      privateKey: this.options.privateKey,
      now: this.#now,
      ...(this.options.kid !== undefined ? { kid: this.options.kid } : {}),
    });

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_assertion_type: ASSERTION_TYPE,
      client_assertion: assertion,
      scope: this.options.scope,
    });

    let response: Response;
    try {
      response = await this.#fetchFn(this.#tokenEndpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
    } catch (error) {
      throw new OpenEmrAuthError("token request failed", { cause: error });
    }

    if (!response.ok) {
      throw new OpenEmrAuthError(`token request failed with status ${response.status}`);
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (error) {
      throw new OpenEmrAuthError("token response was not valid JSON", { cause: error });
    }

    const parsed = TokenResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new OpenEmrAuthError("token response did not match expected shape");
    }

    this.#cached = {
      accessToken: parsed.data.access_token,
      expiresAt: nowSec + parsed.data.expires_in,
    };
    return parsed.data.access_token;
  }
}
