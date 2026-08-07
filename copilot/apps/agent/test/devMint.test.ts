import { describe, it, expect } from "vitest";
import { verifySessionToken } from "@copilot/session-token";
import { buildApp } from "../src/app.js";

const BRIDGE_SECRET = "test-bridge-secret";

describe("GET /dev/session-token (dev-only mint stand-in for the PHP bridge)", () => {
  it("is not registered unless dev minting is explicitly enabled", async () => {
    const app = buildApp({ logger: false, bridgeSecret: BRIDGE_SECRET });
    const res = await app.inject({ method: "GET", url: "/dev/session-token?patientFhirId=x" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("mints a token that verifies against the bridge secret and carries the pid", async () => {
    const app = buildApp({ logger: false, bridgeSecret: BRIDGE_SECRET, devMint: true });
    const res = await app.inject({
      method: "GET",
      url: "/dev/session-token?patientFhirId=fhir-susan",
    });

    expect(res.statusCode).toBe(200);
    const { token } = res.json() as { token: string };
    const now = Math.floor(Date.now() / 1000);
    const verified = verifySessionToken(token, BRIDGE_SECRET, now);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.payload.patientFhirId).toBe("fhir-susan");
      expect(verified.payload.exp).toBeGreaterThan(now);
    }
    await app.close();
  });

  it("rejects a mint request with no patientFhirId", async () => {
    const app = buildApp({ logger: false, bridgeSecret: BRIDGE_SECRET, devMint: true });
    const res = await app.inject({ method: "GET", url: "/dev/session-token" });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
