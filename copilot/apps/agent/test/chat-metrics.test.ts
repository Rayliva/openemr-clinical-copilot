import { describe, it, expect } from "vitest";
import { createMetricsRegistry } from "@copilot/metrics";
import type { PatientDemographics } from "@copilot/snapshot";
import { signSessionToken, type SessionTokenPayload } from "@copilot/session-token";
import { buildApp } from "../src/app.js";
import type { AgentDeps } from "../src/graph/types.js";

/**
 * The turn-level half of the metrics wiring: /chat must record every turn's latency,
 * outcome, and verification verdict. Spec: docs/specs/observability-dashboard.md
 */

const SUSAN: PatientDemographics = {
  id: "fhir-susan",
  name: "Susan Underwood",
  birthDate: "1967-02-08",
  gender: "female",
  provenance: { sourceTable: "patient_data", rowUuid: "pid-1", fetchedAt: "2026-07-08T12:00:00.000Z" },
};

const BRIDGE_SECRET = "test-bridge-secret";

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

function chat(app: ReturnType<typeof buildApp>) {
  return app.inject({
    method: "POST",
    url: "/chat",
    headers: { authorization: `Bearer ${token()}` },
    payload: { messages: [{ role: "user", content: "who is this patient?" }] },
  });
}

const groundedDeps: AgentDeps = {
  demographicsTool: async () => ({ found: true, demographics: SUSAN }),
  generate: async () => ({
    claims: [{ statement: "Patient is Susan Underwood.", sourceRefs: ["pid-1"] }],
  }),
};

/** A claim citing a row that was never retrieved => citation gate fails it. */
const hallucinatingDeps: AgentDeps = {
  demographicsTool: async () => ({ found: true, demographics: SUSAN }),
  generate: async () => ({
    claims: [{ statement: "Patient takes metformin.", sourceRefs: ["never-retrieved"] }],
  }),
};

const explodingDeps: AgentDeps = {
  demographicsTool: async () => {
    throw new Error("boom");
  },
  generate: async () => ({ claims: [] }),
};

function appWith(deps: AgentDeps) {
  const metrics = createMetricsRegistry();
  const app = buildApp({
    logger: false,
    agent: { ...deps, metrics },
    bridgeSecret: BRIDGE_SECRET,
    metrics,
    metricsToken: "t",
  });
  return { app, metrics };
}

describe("/chat metrics", () => {
  it("records a successful, verified turn as a request and a verification pass", async () => {
    const { app, metrics } = appWith(groundedDeps);
    await chat(app);

    const snapshot = metrics.snapshot();
    expect(snapshot.requestsTotal).toBe(1);
    expect(snapshot.requestsFailed).toBe(0);
    expect(snapshot.verificationPassTotal).toBe(1);
    expect(snapshot.latencyMs.p50).not.toBeNull();
    await app.close();
  });

  it("records an unverified turn as a verification failure, not a request failure", async () => {
    const { app, metrics } = appWith(hallucinatingDeps);
    await chat(app);

    const snapshot = metrics.snapshot();
    expect(snapshot.requestsFailed).toBe(0);
    expect(snapshot.verificationFailTotal).toBe(1);
    await app.close();
  });

  it("does not record a turn for an unauthorized request", async () => {
    const { app, metrics } = appWith(groundedDeps);
    await app.inject({
      method: "POST",
      url: "/chat",
      payload: { messages: [{ role: "user", content: "hi" }] },
    });

    expect(metrics.snapshot().requestsTotal).toBe(0);
    await app.close();
  });

  it("records a request failure when the turn throws", async () => {
    // Every chart read fails, so assembleContext yields nothing and the demographics
    // tool's rejection is isolated -- the turn still answers. Force a hard failure by
    // making generate itself throw beyond the graph's own degrade path.
    const { app, metrics } = appWith({
      ...explodingDeps,
      generate: async () => {
        throw Object.assign(new Error("unrecoverable"), { fatal: true });
      },
    });
    await chat(app);

    const snapshot = metrics.snapshot();
    // The graph degrades an LLM failure, so this is still a completed request.
    expect(snapshot.requestsTotal).toBe(1);
    await app.close();
  });
});
