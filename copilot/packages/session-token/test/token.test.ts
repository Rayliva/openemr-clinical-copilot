import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  signSessionToken,
  verifySessionToken,
  isSystemIngestToken,
  SYSTEM_INGEST_SUBJECT,
  type SessionTokenPayload,
} from "../src/index.js";

const SECRET = "test-bridge-secret-0123456789";

/** Public (camelCase) payload the agent consumes. `exp` is future vs the test clock. */
const PAYLOAD: SessionTokenPayload = {
  userId: 6,
  pid: 1,
  patientFhirId: "a2326abc-c03c-4b9e-8af9-b7e03a9b4362",
  correlationId: "corr-abc-123",
  exp: 2_000,
};

/** The snake_case wire shape the same payload serializes to (bridge<->agent contract). */
const WIRE: Record<string, unknown> = {
  user_id: 6,
  pid: 1,
  patient_fhir_id: "a2326abc-c03c-4b9e-8af9-b7e03a9b4362",
  correlation_id: "corr-abc-123",
  exp: 2_000,
};

const NOW = 1_000; // seconds; PAYLOAD.exp (2000) is in the future

describe("verifySessionToken", () => {
  it("fails closed on an empty secret (never verifies against a zero-length key)", () => {
    // An attacker can compute the HMAC over an empty key, so an empty secret must be
    // rejected outright — even a token forged with the empty key must not verify.
    const forged = signSessionToken(PAYLOAD, "");
    const result = verifySessionToken(forged, "", NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("misconfigured");
    }
  });

  it("accepts a well-formed token and returns the typed (camelCase) payload", () => {
    const token = signSessionToken(PAYLOAD, SECRET);
    const result = verifySessionToken(token, SECRET, NOW);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload).toEqual(PAYLOAD);
    }
  });

  it("rejects a token whose signature was tampered", () => {
    const token = signSessionToken(PAYLOAD, SECRET);
    const [head, body] = token.split(".");
    const forged = `${head}.${body}.not-the-real-signature`;

    expect(verifySessionToken(forged, SECRET, NOW)).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("rejects a token signed with a different secret", () => {
    const token = signSessionToken(PAYLOAD, "some-other-secret");
    expect(verifySessionToken(token, SECRET, NOW)).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("rejects an expired token (exp <= now)", () => {
    const token = signSessionToken({ ...PAYLOAD, exp: 900 }, SECRET);
    expect(verifySessionToken(token, SECRET, NOW)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a token that is not three segments", () => {
    expect(verifySessionToken("only.two", SECRET, NOW)).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects a well-signed token whose payload is missing a required field", () => {
    // Validly signed (real secret), but pid is absent — failure must be the payload
    // check, not the signature.
    const token = signWire(
      { user_id: 6, patient_fhir_id: "x", correlation_id: "c", exp: 2_000 },
      SECRET,
    );
    expect(verifySessionToken(token, SECRET, NOW)).toEqual({ ok: false, reason: "invalid-payload" });
  });

  it("rejects a token whose header alg is not HS256", () => {
    // Algorithm-confusion guard: even validly HMAC'd, a non-HS256 alg is refused.
    const token = signWire(WIRE, SECRET, { alg: "none", typ: "JWT" });
    expect(verifySessionToken(token, SECRET, NOW).ok).toBe(false);
  });
});

describe("signSessionToken", () => {
  it("round-trips through verify", () => {
    const token = signSessionToken(PAYLOAD, SECRET);
    expect(verifySessionToken(token, SECRET, PAYLOAD.exp - 1).ok).toBe(true);
  });
});

describe("subject claim (system-ingest vs user tokens)", () => {
  it("a user token (no subject) serializes byte-identically — no subject key", () => {
    const token = signSessionToken(PAYLOAD, SECRET);
    const payloadJson = Buffer.from(token.split(".")[1]!, "base64url").toString("utf8");
    expect(payloadJson).not.toContain("subject");
    expect(JSON.parse(payloadJson)).toEqual(WIRE);
  });

  it("round-trips a system:ingest subject, appended last in the wire JSON", () => {
    const sys: SessionTokenPayload = { ...PAYLOAD, subject: SYSTEM_INGEST_SUBJECT };
    const token = signSessionToken(sys, SECRET);
    const payloadJson = Buffer.from(token.split(".")[1]!, "base64url").toString("utf8");
    // subject must be the LAST key so PHP + TS produce identical bytes (parity).
    expect(payloadJson.endsWith('"subject":"system:ingest"}')).toBe(true);

    const result = verifySessionToken(token, SECRET, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.payload.subject).toBe(SYSTEM_INGEST_SUBJECT);
    expect(isSystemIngestToken(result.payload)).toBe(true);
  });

  it("isSystemIngestToken is false for a user token", () => {
    const result = verifySessionToken(signSessionToken(PAYLOAD, SECRET), SECRET, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(isSystemIngestToken(result.payload)).toBe(false);
  });

  it("rejects an unknown extra field (strict) but accepts the declared subject", () => {
    const withJunk = signWire({ ...WIRE, junk: 1 }, SECRET);
    expect(verifySessionToken(withJunk, SECRET, NOW).ok).toBe(false);
    const withSubject = signWire({ ...WIRE, subject: "system:ingest" }, SECRET);
    expect(verifySessionToken(withSubject, SECRET, NOW).ok).toBe(true);
  });
});

/** Test-only signer emitting arbitrary wire payloads/headers (to exercise rejects). */
function signWire(
  wire: Record<string, unknown>,
  secret: string,
  header: Record<string, unknown> = { alg: "HS256", typ: "JWT" },
): string {
  const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString("base64url");
  const signingInput = `${b64(header)}.${b64(wire)}`;
  const sig = createHmac("sha256", secret).update(signingInput).digest("base64url");
  return `${signingInput}.${sig}`;
}
