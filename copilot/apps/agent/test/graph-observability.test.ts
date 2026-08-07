import { describe, it, expect } from "vitest";
import { createMetricsRegistry } from "@copilot/metrics";
import type { PatientDemographics } from "@copilot/snapshot";
import { buildAgentGraph } from "../src/graph/graph.js";
import type { AgentLogger, DemographicsToolFn, GenerateFn } from "../src/graph/types.js";
import type { RouteTarget, SupervisorRouter } from "../src/graph/supervisor.js";

const SUSAN: PatientDemographics = {
  id: "pid-1",
  name: "Susan Underwood",
  birthDate: "1967-02-08",
  gender: "female",
  provenance: { sourceTable: "patient_data", rowUuid: "pid-1", fetchedAt: "2026-07-08T12:00:00.000Z" },
};
const foundTool: DemographicsToolFn = async () => ({ found: true, demographics: SUSAN });
const okGenerate: GenerateFn = async () => ({
  claims: [{ statement: "Patient is Susan Underwood, DOB 1967-02-08.", sourceRefs: ["pid-1"] }],
});

function scriptRouter(seq: readonly RouteTarget[]): SupervisorRouter {
  let i = 0;
  return async () => {
    const next = seq[i] ?? "ready";
    i += 1;
    return { next, rationale: `hop ${i}` };
  };
}

function captureLogger(): { logger: AgentLogger; events: { msg: string; obj: Record<string, unknown> }[] } {
  const events: { msg: string; obj: Record<string, unknown> }[] = [];
  const logger: AgentLogger = {
    warn: (obj, msg) => events.push({ msg, obj }),
    error: (obj, msg) => events.push({ msg, obj }),
    info: (obj, msg) => events.push({ msg, obj }),
  };
  return { logger, events };
}

describe("graph — W2 supervisor observability", () => {
  it("records routing decisions per target, hops, and terminal turns", async () => {
    const metrics = createMetricsRegistry();
    const graph = buildAgentGraph({
      demographicsTool: foundTool,
      generate: okGenerate,
      supervisor: scriptRouter(["intake_extractor", "ready"]),
      intakeExtractor: async () => ({}),
      metrics,
    });
    await graph.invoke({ patientId: "pid-1", messages: [{ role: "user", content: "process the lab" }] });

    const s = metrics.snapshot();
    expect(s.supervisor.routes.intake_extractor).toBe(1);
    expect(s.supervisor.routes.ready).toBe(1);
    expect(s.supervisor.turnsRouted).toBe(1);
    expect(s.supervisor.hopCapHits).toBe(0);
  });

  it("records a hop-cap hit when the router never converges", async () => {
    const metrics = createMetricsRegistry();
    const graph = buildAgentGraph({
      demographicsTool: foundTool,
      generate: okGenerate,
      supervisor: async () => ({ next: "intake_extractor", rationale: "loop" }),
      intakeExtractor: async () => ({}),
      supervisorMaxHops: 1,
      metrics,
    });
    await graph.invoke({ patientId: "pid-1", messages: [{ role: "user", content: "loop" }] });
    expect(metrics.snapshot().supervisor.hopCapHits).toBeGreaterThanOrEqual(1);
  });

  it("does not record supervisor metrics on the W1 no-supervisor path", async () => {
    const metrics = createMetricsRegistry();
    const graph = buildAgentGraph({ demographicsTool: foundTool, generate: okGenerate, metrics });
    await graph.invoke({ patientId: "pid-1", messages: [{ role: "user", content: "who?" }] });
    expect(metrics.snapshot().supervisor.turnsRouted).toBe(0);
    expect(metrics.snapshot().supervisor.routes).toEqual({});
  });

  it("emits worker.handoff events with the correlation id and target", async () => {
    const { logger, events } = captureLogger();
    const graph = buildAgentGraph({
      demographicsTool: foundTool,
      generate: okGenerate,
      supervisor: scriptRouter(["intake_extractor", "ready"]),
      intakeExtractor: async () => ({}),
      logger,
    });
    await graph.invoke({
      patientId: "pid-1",
      messages: [{ role: "user", content: "process" }],
      correlationId: "corr-9",
    });

    const handoffs = events.filter((e) => e.msg === "worker.handoff");
    expect(handoffs.length).toBe(1);
    expect(handoffs[0]?.obj).toMatchObject({ correlationId: "corr-9", target: "intake_extractor" });
  });

  it("emits retrieval.hit and retrieval.miss events from the evidence-retriever worker", async () => {
    const { logger: hitLogger, events: hitEvents } = captureLogger();
    const hitGraph = buildAgentGraph({
      demographicsTool: foundTool,
      generate: okGenerate,
      supervisor: scriptRouter(["evidence_retriever", "ready"]),
      evidenceRetriever: async () => ({
        evidence: [{ chunkId: "g::0::0", doc: "guide", section: "S", text: "snippet", score: 0.5 }],
        rerank: "used",
      }),
      logger: hitLogger,
    });
    await hitGraph.invoke({ patientId: "pid-1", messages: [{ role: "user", content: "guideline?" }], correlationId: "c1" });
    const hit = hitEvents.find((e) => e.msg === "retrieval.hit");
    expect(hit?.obj).toMatchObject({ correlationId: "c1", snippets: 1, rerank: "used" });

    // A genuine 0-hit query: a query DID run (rerank is set), it just returned no snippets.
    const { logger: missLogger, events: missEvents } = captureLogger();
    const missGraph = buildAgentGraph({
      demographicsTool: foundTool,
      generate: okGenerate,
      supervisor: scriptRouter(["evidence_retriever", "ready"]),
      evidenceRetriever: async () => ({ evidence: [], rerank: "used" }),
      logger: missLogger,
    });
    await missGraph.invoke({ patientId: "pid-1", messages: [{ role: "user", content: "guideline?" }], correlationId: "c2" });
    const miss = missEvents.find((e) => e.msg === "retrieval.miss");
    expect(miss?.obj).toMatchObject({ correlationId: "c2", snippets: 0, rerank: "used" });

    // The empty-query path (no query ran → no `rerank`, no metric recorded) must emit NO
    // retrieval log — otherwise the log stream and the metric snapshot disagree on query count.
    const { logger: noRunLogger, events: noRunEvents } = captureLogger();
    const noRunGraph = buildAgentGraph({
      demographicsTool: foundTool,
      generate: okGenerate,
      supervisor: scriptRouter(["evidence_retriever", "ready"]),
      evidenceRetriever: async () => ({ evidence: [] }),
      logger: noRunLogger,
    });
    await noRunGraph.invoke({ patientId: "pid-1", messages: [{ role: "user", content: "guideline?" }], correlationId: "c3" });
    expect(noRunEvents.some((e) => e.msg === "retrieval.hit" || e.msg === "retrieval.miss")).toBe(false);
  });
});
