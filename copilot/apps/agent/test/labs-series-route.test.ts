import { describe, it, expect } from "vitest";
import { signSessionToken, SYSTEM_INGEST_SUBJECT, type SessionTokenPayload } from "@copilot/session-token";
import type { LabSeriesResult } from "@copilot/snapshot";
import { buildApp } from "../src/app.js";
import type { LabSeriesReader } from "../src/routes/labs.js";

const BRIDGE_SECRET = "test-bridge-secret";

function tokenFor(patientFhirId: string, overrides: Partial<SessionTokenPayload> = {}): string {
  const payload: SessionTokenPayload = {
    userId: 6,
    pid: 1,
    patientFhirId,
    correlationId: "corr",
    exp: 9_999_999_999,
    ...overrides,
  };
  return signSessionToken(payload, BRIDGE_SECRET);
}

const SERIES: LabSeriesResult = {
  documented: true,
  series: [
    {
      test: "Hemoglobin A1c",
      code: "4548-4",
      unit: "%",
      points: [
        { date: "2026-01-10", value: 8.1, rawValue: "8.1", obsUuid: "obs-1" },
        { date: "2026-07-04", value: 6.9, rawValue: "6.9", obsUuid: "obs-2" },
      ],
    },
  ],
};

function build(reader: LabSeriesReader) {
  return buildApp({ logger: false, bridgeSecret: BRIDGE_SECRET, labSeriesReader: reader });
}

describe("POST /labs/series — token-bound lab-trend endpoint", () => {
  it("AC4: 401 without a bearer token", async () => {
    const app = build(async () => SERIES);
    const res = await app.inject({ method: "POST", url: "/labs/series", payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it("AC4: 401 with an invalid token", async () => {
    const app = build(async () => SERIES);
    const res = await app.inject({
      method: "POST",
      url: "/labs/series",
      headers: { authorization: "Bearer not-a-real-token" },
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it("AC4: 403 for a confined system-ingest token (never a read path)", async () => {
    const app = build(async () => SERIES);
    const res = await app.inject({
      method: "POST",
      url: "/labs/series",
      headers: { authorization: `Bearer ${tokenFor("pid-2", { subject: SYSTEM_INGEST_SUBJECT })}` },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it("AC4: 200 for a valid token, serving the series for the token's bound pid", async () => {
    const seenPid: string[] = [];
    const app = build(async (pid) => {
      seenPid.push(pid);
      return SERIES;
    });
    const res = await app.inject({
      method: "POST",
      url: "/labs/series",
      headers: { authorization: `Bearer ${tokenFor("pid-grace")}` },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(seenPid).toEqual(["pid-grace"]); // pid comes from the token, never the body
    expect(res.json()).toEqual(SERIES);
  });

  it("returns 502 (generic) when the reader throws — never leaks internals", async () => {
    const app = build(async () => {
      throw new Error("fhir 500: internal detail");
    });
    const res = await app.inject({
      method: "POST",
      url: "/labs/series",
      headers: { authorization: `Bearer ${tokenFor("pid-2")}` },
      payload: {},
    });
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toContain("internal detail");
  });

  it("is NOT registered without a bridge secret (fail-closed)", async () => {
    const app = buildApp({ logger: false, labSeriesReader: async () => SERIES });
    const res = await app.inject({
      method: "POST",
      url: "/labs/series",
      headers: { authorization: `Bearer ${tokenFor("pid-2")}` },
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });
});
