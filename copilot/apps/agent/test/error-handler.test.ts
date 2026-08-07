import { describe, it, expect } from "vitest";
import type { PatientDemographics } from "@copilot/snapshot";
import { signSessionToken, type SessionTokenPayload } from "@copilot/session-token";
import { buildApp } from "../src/app.js";
import type { AgentDeps } from "../src/graph/types.js";
import type { RequestTracerFactory } from "../src/observability/tracing.js";

/**
 * The boundary error handler must never surface a raw internal error to the caller
 * (it may carry SQL, paths, or PHI). Spec: docs/code-review-findings.md #7/#9,
 * `.claude/rules/error-handling-and-logging.md`.
 */

const SUSAN: PatientDemographics = {
  id: "fhir-susan",
  name: "Susan Underwood",
  birthDate: "1967-02-08",
  gender: "female",
  provenance: { sourceTable: "patient_data", rowUuid: "pid-1", fetchedAt: "2026-07-08T12:00:00.000Z" },
};

const BRIDGE_SECRET = "test-bridge-secret";
const SECRET_INTERNAL_DETAIL = "connect ECONNREFUSED 10.0.0.5:5432 password=hunter2";

function token(): string {
  const payload: SessionTokenPayload = {
    userId: 6,
    pid: 1,
    patientFhirId: "fhir-susan",
    correlationId: "corr-1",
    exp: 9_999_999_999,
  };
  return signSessionToken(payload, BRIDGE_SECRET);
}

const deps: AgentDeps = {
  demographicsTool: async () => ({ found: true, demographics: SUSAN }),
  generate: async () => ({ claims: [{ statement: "Patient is Susan.", sourceRefs: ["pid-1"] }] }),
};

/**
 * A tracer whose span() throws with an internal, sensitive message *during* the turn.
 * A span op runs inside `graph.invoke` (via tracedSpan on the first node), so the throw
 * reaches the route's catch, is re-thrown, and must be sanitized by the boundary handler.
 * (We deliberately trigger the error via span(), not flush(): flush now runs
 * fire-and-forget AFTER the response, off the critical path, so it can no longer reach
 * the caller — see the flush-resilience test below.)
 */
const explodingTracer: RequestTracerFactory = {
  start: () => ({
    span: () => {
      throw new Error(SECRET_INTERNAL_DETAIL);
    },
    generation: () => ({ end: () => {} }),
    end: () => {},
  }),
  flush: async () => {},
  shutdown: async () => {},
};

/** A tracer whose flush() rejects with a sensitive message — must be swallowed, not surfaced. */
const flushThrowingTracer: RequestTracerFactory = {
  start: () => ({
    span: () => ({ end: () => {} }),
    generation: () => ({ end: () => {} }),
    end: () => {},
  }),
  flush: async () => {
    throw new Error(SECRET_INTERNAL_DETAIL);
  },
  shutdown: async () => {},
};

describe("boundary error handler", () => {
  it("returns a generic error with the correlation id, never the raw internal message", async () => {
    const app = buildApp({
      logger: false,
      agent: deps,
      bridgeSecret: BRIDGE_SECRET,
      tracerFactory: explodingTracer,
    });

    const res = await app.inject({
      method: "POST",
      url: "/chat",
      headers: { authorization: `Bearer ${token()}` },
      payload: { messages: [{ role: "user", content: "who is this patient?" }] },
    });

    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain("ECONNREFUSED");
    expect(res.body).not.toContain("hunter2");
    const body = res.json();
    expect(body.error).toBe("internal error");
    expect(typeof body.correlationId).toBe("string");
    await app.close();
  });

  it("a failing trace flush never breaks or leaks into the response (flush is off the critical path)", async () => {
    const app = buildApp({
      logger: false,
      agent: deps,
      bridgeSecret: BRIDGE_SECRET,
      tracerFactory: flushThrowingTracer,
    });

    const res = await app.inject({
      method: "POST",
      url: "/chat",
      headers: { authorization: `Bearer ${token()}` },
      payload: { messages: [{ role: "user", content: "who is this patient?" }] },
    });

    // The answer streamed successfully; the flush rejection was swallowed (logged), and
    // its sensitive message never reached the caller.
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Susan");
    expect(res.body).not.toContain("ECONNREFUSED");
    expect(res.body).not.toContain("hunter2");
    await app.close();
  });
});
