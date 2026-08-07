import { describe, it, expect } from "vitest";
import { generateKeyPair, jwtVerify, decodeProtectedHeader, decodeJwt } from "jose";
import { createClientAssertion } from "../src/oauth/assertion.js";

const TOKEN_ENDPOINT = "https://oe.test/oauth2/default/token";

// One RS384 keypair for the whole suite — a fresh RSA key per test is CPU-expensive and flaky-times-out
// under the full parallel suite's contention. These tests exercise assertion building, not keygen.
const { publicKey, privateKey } = await generateKeyPair("RS384");

describe("createClientAssertion", () => {
  it("produces an RS384 JWT with the required claims, verifiable by the public key", async () => {

    const jwt = await createClientAssertion({
      clientId: "client-123",
      tokenEndpoint: TOKEN_ENDPOINT,
      privateKey,
      kid: "key-1",
      now: () => new Date("2026-07-08T12:00:00Z"),
      jti: () => "jti-abc",
    });

    expect(decodeProtectedHeader(jwt)).toMatchObject({ alg: "RS384", typ: "JWT", kid: "key-1" });

    // Verify at a time inside the token's window (signing clock was pinned to noon).
    const { payload } = await jwtVerify(jwt, publicKey, {
      audience: TOKEN_ENDPOINT,
      currentDate: new Date("2026-07-08T12:01:00Z"),
    });
    expect(payload.iss).toBe("client-123");
    expect(payload.sub).toBe("client-123");
    expect(payload.jti).toBe("jti-abc");
    expect(payload.exp).toBeDefined();
    expect(payload.iat).toBeDefined();
    expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(300);
    expect(payload.exp! - payload.iat!).toBeGreaterThan(0);
  });

  it("uses a unique jti on each call by default", async () => {
    const make = () =>
      createClientAssertion({ clientId: "c", tokenEndpoint: TOKEN_ENDPOINT, privateKey });

    const [a, b] = await Promise.all([make(), make()]);
    const jtiA = decodeJwt(a).jti;
    const jtiB = decodeJwt(b).jti;

    expect(jtiA).toBeTruthy();
    expect(jtiA).not.toBe(jtiB);
  });
});
