import { describe, it, expect } from "vitest";
import type { PatientDemographics } from "@copilot/snapshot";
import { signSessionToken, type SessionTokenPayload } from "@copilot/session-token";
import { buildApp } from "../src/app.js";
import { sseAnswerChunks, tagCitedSources } from "../src/routes/chat.js";
import type { AgentDeps } from "../src/graph/types.js";
import type { RequestTracerFactory, Tracer } from "../src/observability/tracing.js";

const SUSAN: PatientDemographics = {
  id: "fhir-susan",
  name: "Susan Underwood",
  birthDate: "1967-02-08",
  gender: "female",
  provenance: { sourceTable: "patient_data", rowUuid: "pid-1", fetchedAt: "2026-07-08T12:00:00.000Z" },
};

const BRIDGE_SECRET = "test-bridge-secret";

/** A token bound to Susan's FHIR id, valid far into the future. */
function tokenFor(
  patientFhirId: string,
  overrides: Partial<SessionTokenPayload> = {},
): string {
  const payload: SessionTokenPayload = {
    userId: 6,
    pid: 1,
    patientFhirId,
    correlationId: "corr-from-token",
    exp: 9_999_999_999,
    ...overrides,
  };
  return signSessionToken(payload, BRIDGE_SECRET);
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/** Deps whose demographics tool records the pid it was actually called with. */
function makeDeps(): { deps: AgentDeps; calledWith: string[] } {
  const calledWith: string[] = [];
  const deps: AgentDeps = {
    demographicsTool: async ({ patientId }) => {
      calledWith.push(patientId);
      return { found: true, demographics: SUSAN };
    },
    generate: async () => ({
      claims: [{ statement: "Susan Underwood, DOB 1967-02-08.", sourceRefs: ["pid-1"] }],
    }),
  };
  return { deps, calledWith };
}

function build(deps: AgentDeps) {
  return buildApp({ logger: false, agent: deps, bridgeSecret: BRIDGE_SECRET });
}

/**
 * A tracer factory whose `flush()` blocks until released, so a test can prove the answer
 * is streamed WITHOUT waiting on trace delivery: with a blocking flush the response would
 * hang; off the critical path it completes while flush is still pending.
 */
function makeGatedTracer(): {
  factory: RequestTracerFactory;
  flushCalled: () => boolean;
  releaseFlush: () => void;
} {
  let flushCalled = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tracer: Tracer = {
    span: () => ({ end() {} }),
    generation: () => ({ end() {} }),
    end() {},
  };
  const factory: RequestTracerFactory = {
    start: () => tracer,
    flush: async () => {
      flushCalled = true;
      await gate;
    },
    shutdown: async () => {},
  };
  return { factory, flushCalled: () => flushCalled, releaseFlush: release };
}

describe("POST /chat auth (boundary #1)", () => {
  it("rejects with 401 when no Authorization header is present", async () => {
    const app = build(makeDeps().deps);
    const res = await app.inject({
      method: "POST",
      url: "/chat",
      payload: { messages: [{ role: "user", content: "who is this?" }] },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("rejects with 401 when the token signature is invalid", async () => {
    const app = build(makeDeps().deps);
    const res = await app.inject({
      method: "POST",
      url: "/chat",
      headers: auth(tokenFor("fhir-susan") + "tampered"),
      payload: { messages: [{ role: "user", content: "who is this?" }] },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("rejects with 401 when the token is expired", async () => {
    const app = build(makeDeps().deps);
    const res = await app.inject({
      method: "POST",
      url: "/chat",
      headers: auth(tokenFor("fhir-susan", { exp: 1 })),
      payload: { messages: [{ role: "user", content: "who is this?" }] },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe("POST /chat (SSE)", () => {
  it("streams a grounded answer as SSE with a done event when the token is valid", async () => {
    const { deps } = makeDeps();
    const app = build(deps);
    const res = await app.inject({
      method: "POST",
      url: "/chat",
      headers: auth(tokenFor("fhir-susan")),
      payload: { messages: [{ role: "user", content: "who is this?" }] },
    });

    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.payload).toContain("Susan");
    expect(res.payload).toContain("event: done");
    await app.close();
  });

  it("ships the machine-readable citation contract (verified claim → source rows) in the done frame", async () => {
    const { deps } = makeDeps();
    const app = build(deps);
    const res = await app.inject({
      method: "POST",
      url: "/chat",
      headers: auth(tokenFor("fhir-susan")),
      payload: { messages: [{ role: "user", content: "who is this?" }] },
    });

    const doneMatch = /event: done\ndata: (.+)/.exec(res.payload);
    const done = JSON.parse(doneMatch?.[1] ?? "{}") as {
      citations?: ReadonlyArray<{
        statement: string;
        sourceRefs: readonly string[];
        sources: ReadonlyArray<{ ref: string; kind: string }>;
        citation: ReadonlyArray<{
          source_type: string;
          source_id: string;
          page_or_section: string;
          field_or_chunk_id: string;
          quote_or_value: string;
        }>;
      }>;
    };
    // The grounded claim is surfaced with the source row uuid(s) that back it — the citation contract.
    expect(done.citations).toBeDefined();
    expect(done.citations?.length).toBeGreaterThan(0);
    expect(done.citations?.[0]).toMatchObject({
      statement: expect.stringContaining("Susan"),
      sourceRefs: ["pid-1"],
      // No guideline evidence in this turn → the source is tagged as a chart row (for the source viewer).
      sources: [{ ref: "pid-1", kind: "chart" }],
    });
    // The full 5-field machine citation for the chart claim (`w2-citation-completeness`).
    expect(done.citations?.[0]?.citation).toEqual([
      {
        source_type: "chart",
        source_id: "pid-1",
        page_or_section: "patient_data",
        field_or_chunk_id: "pid-1",
        quote_or_value: expect.stringContaining("Susan") as unknown as string,
      },
    ]);
    await app.close();
  });

  it("streams the answer without waiting on the trace flush (flush off the critical path)", async () => {
    const { deps } = makeDeps();
    const tracer = makeGatedTracer();
    const app = buildApp({
      logger: false,
      agent: deps,
      bridgeSecret: BRIDGE_SECRET,
      tracerFactory: tracer.factory,
    });

    // flush() never resolves during this call; the response must still complete. With a
    // blocking flush on the critical path this inject would hang until the test times out.
    const res = await app.inject({
      method: "POST",
      url: "/chat",
      headers: auth(tokenFor("fhir-susan")),
      payload: { messages: [{ role: "user", content: "who is this?" }] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain("Susan");
    expect(res.payload).toContain("event: done");
    // Tracing still happens — the flush was fired, just not awaited before responding.
    expect(tracer.flushCalled()).toBe(true);

    tracer.releaseFlush();
    await app.close();
  }, 5000);

  it("never ships a grounding-dropped claim's TEXT to the client (only the reason)", async () => {
    const FABRICATED = "eGFR 34, avoid metformin";
    const JUDGE_REASON = "not supported by the cited evidence";
    // generate emits a claim that cites a real retrieved row (passes L1) but the judge
    // rules it unsupported (fails L2) and no retry salvages it → it becomes an ungrounded note.
    const dropDeps: AgentDeps = {
      demographicsTool: async () => ({ found: true, demographics: SUSAN }),
      generate: async () => ({
        claims: [{ statement: `Fabricated: ${FABRICATED}.`, sourceRefs: ["pid-1"] }],
      }),
      groundingJudge: async () => ({ grounded: false, reason: JUDGE_REASON }),
      groundingMaxRetries: 0,
    };
    const app = build(dropDeps);

    const res = await app.inject({
      method: "POST",
      url: "/chat",
      headers: auth(tokenFor("fhir-susan")),
      payload: { messages: [{ role: "user", content: "what's her renal status?" }] },
    });

    // The dropped statement (potentially fabricated clinical content) must appear NOWHERE
    // in the stream — not the body, not the done frame. Only the judge's reason may show.
    expect(res.payload).not.toContain(FABRICATED);
    expect(res.payload).toContain(JUDGE_REASON);
    await app.close();
  });

  it("scopes the chart read to the token's pid, ignoring any patientId in the body", async () => {
    const { deps, calledWith } = makeDeps();
    const app = build(deps);
    await app.inject({
      method: "POST",
      url: "/chat",
      headers: auth(tokenFor("fhir-susan")),
      // A caller trying to redirect the read to another patient must be ignored.
      payload: {
        patientId: "fhir-someone-else",
        messages: [{ role: "user", content: "who is this?" }],
      },
    });

    expect(calledWith).toEqual(["fhir-susan"]);
    await app.close();
  });

  it("echoes the token's correlation id on the response header", async () => {
    const { deps } = makeDeps();
    const app = build(deps);
    const res = await app.inject({
      method: "POST",
      url: "/chat",
      headers: auth(tokenFor("fhir-susan", { correlationId: "corr-xyz" })),
      payload: { messages: [{ role: "user", content: "who is this?" }] },
    });

    expect(res.headers["x-correlation-id"]).toBe("corr-xyz");
    await app.close();
  });

  it("accepts a multi-turn message history", async () => {
    const { deps } = makeDeps();
    const app = build(deps);
    const res = await app.inject({
      method: "POST",
      url: "/chat",
      headers: auth(tokenFor("fhir-susan")),
      payload: {
        messages: [
          { role: "user", content: "who is this?" },
          { role: "assistant", content: "Susan Underwood." },
          { role: "user", content: "her DOB?" },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain("Susan");
    await app.close();
  });

  it("returns 400 on an invalid body even with a valid token", async () => {
    const { deps } = makeDeps();
    const app = build(deps);
    const res = await app.inject({
      method: "POST",
      url: "/chat",
      headers: auth(tokenFor("fhir-susan")),
      payload: { messages: [] },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("is not registered when no agent deps are provided", async () => {
    const app = buildApp({ logger: false });
    const res = await app.inject({ method: "POST", url: "/chat", payload: {} });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("fails closed: /chat is NOT registered when the bridge secret is empty", async () => {
    // An empty secret would let the agent verify against a publicly-computable HMAC key,
    // accepting forged tokens. The route must not exist at all in that misconfiguration.
    const { deps } = makeDeps();
    const app = buildApp({ logger: false, agent: deps, bridgeSecret: "" });
    const res = await app.inject({
      method: "POST",
      url: "/chat",
      headers: { authorization: "Bearer anything" },
      payload: { messages: [{ role: "user", content: "hi" }] },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe("tagCitedSources", () => {
  const evidence = [
    { chunkId: "ada::1::0", doc: "ADA-2024", section: "Glycemic targets", text: "A1c goal < 7% for most adults", score: 0.9 },
  ];

  it("tags a ref that matches a retrieved guideline chunk with its passage text", () => {
    expect(tagCitedSources(["ada::1::0"], evidence)).toEqual([
      { ref: "ada::1::0", kind: "guideline", doc: "ADA-2024", section: "Glycemic targets", text: "A1c goal < 7% for most adults" },
    ]);
  });

  it("tags a ref not in the evidence as a chart row (module resolves any source document)", () => {
    expect(tagCitedSources(["row-uuid-9"], evidence)).toEqual([{ ref: "row-uuid-9", kind: "chart" }]);
  });

  it("carries the page number when the guideline chunk has one", () => {
    const withPage = [{ chunkId: "cdc::2::0", doc: "CDC", section: "S", text: "t", page: 4, score: 0.5 }];
    expect(tagCitedSources(["cdc::2::0"], withPage)[0]).toMatchObject({ kind: "guideline", page: 4 });
  });

  it("never carries PHI for a chart row — only the opaque ref + kind", () => {
    expect(tagCitedSources(["abc"], [])).toEqual([{ ref: "abc", kind: "chart" }]);
  });
});

describe("sseAnswerChunks", () => {
  it("splits an answer into SSE data frames", () => {
    const chunks = sseAnswerChunks("hello world");
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toContain("data: ");
    expect(chunks.join("")).toContain("hello");
  });
});
