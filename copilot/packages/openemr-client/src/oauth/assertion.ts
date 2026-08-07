import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";

/** The private-key type `jose` accepts for signing (version-proof). */
export type SigningKey = Parameters<SignJWT["sign"]>[0];

export interface ClientAssertionParams {
  readonly clientId: string;
  readonly tokenEndpoint: string;
  readonly privateKey: SigningKey;
  readonly kid?: string;
  /** Assertion lifetime; clamped to the 5-minute maximum OpenEMR allows. */
  readonly ttlSeconds?: number;
  /** Injectable clock (testability). */
  readonly now?: () => Date;
  /** Injectable jti generator (testability); defaults to a random UUID. */
  readonly jti?: () => string;
}

const MAX_TTL_SECONDS = 300;
/**
 * Default assertion lifetime. Well under the 5-minute cap: the assertion is
 * consumed within seconds, and a margin tolerates clock skew between the agent
 * host and OpenEMR (exactly `iat + 300` intermittently fails when the host clock
 * runs ahead).
 */
const DEFAULT_TTL_SECONDS = 120;

/**
 * Build and RS384-sign the `private_key_jwt` client assertion for OpenEMR's
 * client-credentials grant. Claims: iss = sub = clientId, aud = tokenEndpoint,
 * iat = now, exp = now + ttl (≤5min), unique jti.
 */
export async function createClientAssertion(params: ClientAssertionParams): Promise<string> {
  const nowDate = (params.now ?? (() => new Date()))();
  const iat = Math.floor(nowDate.getTime() / 1000);
  const ttl = Math.min(params.ttlSeconds ?? DEFAULT_TTL_SECONDS, MAX_TTL_SECONDS);
  const exp = iat + ttl;
  const jti = (params.jti ?? randomUUID)();

  const header: { alg: "RS384"; typ: "JWT"; kid?: string } = { alg: "RS384", typ: "JWT" };
  if (params.kid !== undefined) {
    header.kid = params.kid;
  }

  return new SignJWT({})
    .setProtectedHeader(header)
    .setIssuer(params.clientId)
    .setSubject(params.clientId)
    .setAudience(params.tokenEndpoint)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .setJti(jti)
    .sign(params.privateKey);
}
