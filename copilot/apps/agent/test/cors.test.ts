import { describe, it, expect } from "vitest";
import type { PatientDemographics } from "@copilot/snapshot";
import { signSessionToken } from "@copilot/session-token";
import { buildApp } from "../src/app.js";
import type { AgentDeps } from "../src/graph/types.js";

const SUSAN: PatientDemographics = {
  id: "fhir-susan",
  name: "Susan Underwood",
  birthDate: "1967-02-08",
  gender: "female",
  provenance: { sourceTable: "patient_data", rowUuid: "pid-1", fetchedAt: "2026-07-08T12:00:00.000Z" },
};

const BRIDGE_SECRET = "test-bridge-secret";
const ALLOWED = "https://emr.example.test";

const deps: AgentDeps = {
  demographicsTool: async () => ({ found: true, demographics: SUSAN }),
  generate: async () => ({ claims: [{ statement: "Susan Underwood.", sourceRefs: ["pid-1"] }] }),
};

function token(): string {
  return signSessionToken(
    { userId: 6, pid: 1, patientFhirId: "fhir-susan", correlationId: "c", exp: 9_999_999_999 },
    BRIDGE_SECRET,
  );
}

function build() {
  return buildApp({ logger: false, agent: deps, bridgeSecret: BRIDGE_SECRET, allowedOrigin: ALLOWED });
}

describe("CORS on /chat (embedded UI is cross-origin to the agent)", () => {
  it("answers the OPTIONS preflight from the allowed origin with the CORS headers", async () => {
    const app = build();
    const res = await app.inject({
      method: "OPTIONS",
      url: "/chat",
      headers: { origin: ALLOWED, "access-control-request-method": "POST" },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED);
    expect(String(res.headers["access-control-allow-headers"]).toLowerCase()).toContain("authorization");
    expect(String(res.headers["access-control-allow-methods"])).toContain("POST");
    await app.close();
  });

  it("echoes the allow-origin header on a successful POST from the allowed origin", async () => {
    const app = build();
    const res = await app.inject({
      method: "POST",
      url: "/chat",
      headers: { origin: ALLOWED, authorization: `Bearer ${token()}` },
      payload: { messages: [{ role: "user", content: "who is this?" }] },
    });
    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED);
    await app.close();
  });

  it("does NOT send allow-origin for a disallowed origin", async () => {
    const app = build();
    const res = await app.inject({
      method: "OPTIONS",
      url: "/chat",
      headers: { origin: "https://evil.example", "access-control-request-method": "POST" },
    });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    await app.close();
  });

  it("sends allow-origin on a 401 too, so the browser can read the rejection", async () => {
    const app = build();
    const res = await app.inject({
      method: "POST",
      url: "/chat",
      headers: { origin: ALLOWED },
      payload: { messages: [{ role: "user", content: "hi" }] },
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED);
    await app.close();
  });

  it("adds no CORS headers when no allowed origin is configured (back-compat)", async () => {
    const app = buildApp({ logger: false, agent: deps, bridgeSecret: BRIDGE_SECRET });
    const res = await app.inject({
      method: "OPTIONS",
      url: "/chat",
      headers: { origin: ALLOWED, "access-control-request-method": "POST" },
    });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    await app.close();
  });
});
