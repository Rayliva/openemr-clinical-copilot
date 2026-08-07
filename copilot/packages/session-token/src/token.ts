import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * The boundary-#1 session token (`ARCHITECTURE.md §Boundaries #1`). Minted by the
 * OpenEMR identity bridge for a patient the authenticated physician owns, verified
 * by the agent on every request. The pid the agent operates on comes from here —
 * never from the request body or model output (`authorization-and-pid-scope` rule).
 *
 * This module is pure (no Fastify / no env reads) and unit-testable in isolation.
 */

/** camelCase payload the agent consumes after verification. */
export interface SessionTokenPayload {
  /** OpenEMR `users.id` of the authenticated physician (disclosure log). */
  readonly userId: number;
  /** OpenEMR internal `patient_data.pid` (disclosure log / human reference). */
  readonly pid: number;
  /** FHIR Patient resource id (`patient_data.uuid`) — what every FHIR read uses. */
  readonly patientFhirId: string;
  /** Correlation id minted at the bridge; threads logs/tools/LLM (E2). */
  readonly correlationId: string;
  /** Expiry, Unix seconds. */
  readonly exp: number;
  /**
   * Token subject/principal. Absent or `user:*` = a physician session token (the normal path).
   * `system:ingest` = a confined system-trigger token minted server-side for upload-time extraction
   * — the agent restricts it to `/documents/extract` only (never `/chat`, `/pending`, `/status`), so
   * it cannot be replayed to read answers or drafts (`authorization-and-pid-scope`).
   */
  readonly subject?: string;
}

/** The one subject that marks a confined system-ingest token. */
export const SYSTEM_INGEST_SUBJECT = "system:ingest";

/** True iff the token is the confined system-ingest principal (not a user session). */
export function isSystemIngestToken(payload: SessionTokenPayload): boolean {
  return payload.subject === SYSTEM_INGEST_SUBJECT;
}

/** Discriminated result — never throws; the caller decides the HTTP response. */
export type VerifyResult =
  | { readonly ok: true; readonly payload: SessionTokenPayload }
  | { readonly ok: false; readonly reason: VerifyFailure };

export type VerifyFailure =
  | "malformed"
  | "bad-signature"
  | "expired"
  | "invalid-payload"
  | "misconfigured";

/**
 * snake_case wire contract shared with the PHP mint bridge. Zod is the source of
 * truth for the shape; `.strict()` rejects unexpected fields.
 */
const WirePayloadSchema = z
  .object({
    user_id: z.number().int().positive(),
    pid: z.number().int().positive(),
    patient_fhir_id: z.string().min(1),
    correlation_id: z.string().min(1),
    exp: z.number().int(),
    // Optional so existing user tokens (no subject) stay byte-identical to before; the system-ingest
    // mint sets it. `.strict()` still rejects any OTHER unexpected field.
    subject: z.string().min(1).optional(),
  })
  .strict();

type WirePayload = z.infer<typeof WirePayloadSchema>;

const HEADER = { alg: "HS256", typ: "JWT" } as const;

function b64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function toWire(payload: SessionTokenPayload): WirePayload {
  const wire: WirePayload = {
    user_id: payload.userId,
    pid: payload.pid,
    patient_fhir_id: payload.patientFhirId,
    correlation_id: payload.correlationId,
    exp: payload.exp,
  };
  // Append `subject` LAST and only when set, so a user token (no subject) serializes byte-identically
  // to the pre-existing shape (the PHP minter appends it the same way — parity holds).
  if (payload.subject !== undefined) {
    return { ...wire, subject: payload.subject };
  }
  return wire;
}

function fromWire(wire: WirePayload): SessionTokenPayload {
  const payload: SessionTokenPayload = {
    userId: wire.user_id,
    pid: wire.pid,
    patientFhirId: wire.patient_fhir_id,
    correlationId: wire.correlation_id,
    exp: wire.exp,
  };
  if (wire.subject !== undefined) {
    return { ...payload, subject: wire.subject };
  }
  return payload;
}

function hmac(signingInput: string, secret: string): string {
  return createHmac("sha256", secret).update(signingInput).digest("base64url");
}

/**
 * Sign a payload into a compact `base64url(header).base64url(payload).sig` token
 * (HS256). Used by tests and local dev minting; the PHP bridge mints the identical
 * wire shape in production.
 */
export function signSessionToken(payload: SessionTokenPayload, secret: string): string {
  const signingInput = `${b64urlJson(HEADER)}.${b64urlJson(toWire(payload))}`;
  return `${signingInput}.${hmac(signingInput, secret)}`;
}

/** Constant-time signature comparison; false on any length/content mismatch. */
function signaturesMatch(expected: string, actual: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

function decodeJson(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

/**
 * Verify a token: three-segment shape → HS256 header → signature → payload schema →
 * expiry. `nowSeconds` is injected (clock injection; no ambient time) so verification
 * is deterministic and testable. Never throws.
 */
export function verifySessionToken(
  token: string,
  secret: string,
  nowSeconds: number,
): VerifyResult {
  // Fail CLOSED on a missing secret. An empty key produces a publicly-computable HMAC,
  // so verifying against it would accept attacker-forged tokens — never authenticate
  // with a zero-length key.
  if (secret.length === 0) {
    return { ok: false, reason: "misconfigured" };
  }

  const parts = token.split(".");
  const [headerSeg, payloadSeg, signature] = parts;
  if (
    parts.length !== 3 ||
    headerSeg === undefined ||
    payloadSeg === undefined ||
    signature === undefined
  ) {
    return { ok: false, reason: "malformed" };
  }

  let header: unknown;
  try {
    header = decodeJson(headerSeg);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (
    typeof header !== "object" ||
    header === null ||
    (header as { alg?: unknown }).alg !== "HS256"
  ) {
    return { ok: false, reason: "malformed" };
  }

  const expected = hmac(`${headerSeg}.${payloadSeg}`, secret);
  if (!signaturesMatch(expected, signature)) {
    return { ok: false, reason: "bad-signature" };
  }

  let rawPayload: unknown;
  try {
    rawPayload = decodeJson(payloadSeg);
  } catch {
    return { ok: false, reason: "invalid-payload" };
  }
  const parsed = WirePayloadSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return { ok: false, reason: "invalid-payload" };
  }

  if (parsed.data.exp <= nowSeconds) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, payload: fromWire(parsed.data) };
}
