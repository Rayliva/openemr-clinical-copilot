import { describe, it, expect } from "vitest";
import type { PatientDemographics } from "@copilot/snapshot";
import { buildAgentGraph } from "../src/graph/graph.js";
import type { DemographicsToolFn, GenerateFn } from "../src/graph/types.js";
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

/** A router that emits a fixed sequence of decisions, one per hop, then `ready`. */
function scriptRouter(seq: readonly RouteTarget[]): SupervisorRouter {
  let i = 0;
  return async () => {
    const next = seq[i] ?? "ready";
    i += 1;
    return { next, rationale: `hop ${i}` };
  };
}

describe("supervisor + workers graph wiring", () => {
  it("with no supervisor injected, behaves exactly like W1 (ready, no workers run)", async () => {
    const graph = buildAgentGraph({ demographicsTool: foundTool, generate: okGenerate });
    const out = await graph.invoke({
      patientId: "pid-1",
      messages: [{ role: "user", content: "who is this?" }],
    });
    expect(out.answer).toContain("Susan Underwood");
    expect(out.route).toBe("ready");
    expect(out.routedWorkers).toEqual([]);
  });

  it("routes to intake_extractor once then answers through the full gate", async () => {
    let extractorCalls = 0;
    const graph = buildAgentGraph({
      demographicsTool: foundTool,
      generate: okGenerate,
      supervisor: scriptRouter(["intake_extractor", "ready"]),
      intakeExtractor: async () => {
        extractorCalls += 1;
        return {};
      },
    });
    const out = await graph.invoke({
      patientId: "pid-1",
      messages: [{ role: "user", content: "process the uploaded lab" }],
    });
    expect(extractorCalls).toBe(1);
    expect(out.routedWorkers).toEqual(["intake_extractor"]);
    expect(out.answer).toContain("Susan Underwood");
    expect(out.verdict?.ok).toBe(true);
  });

  it("routes to both workers, each once", async () => {
    const graph = buildAgentGraph({
      demographicsTool: foundTool,
      generate: okGenerate,
      supervisor: scriptRouter(["evidence_retriever", "intake_extractor", "ready"]),
      intakeExtractor: async () => ({}),
      evidenceRetriever: async () => ({
        evidence: [
          { chunkId: "g::0::0", doc: "guide", section: "S", text: "a guideline snippet", score: 0.5 },
        ],
      }),
    });
    const out = await graph.invoke({
      patientId: "pid-1",
      messages: [{ role: "user", content: "what does the guideline say and process the doc" }],
    });
    expect(out.routedWorkers).toContain("intake_extractor");
    expect(out.routedWorkers).toContain("evidence_retriever");
    expect(out.evidence.map((e) => e.chunkId)).toContain("g::0::0");
    expect(out.answer).toContain("Susan Underwood");
  });

  it("is bounded: a router that always wants a worker still terminates and answers", async () => {
    let extractorCalls = 0;
    const graph = buildAgentGraph({
      demographicsTool: foundTool,
      generate: okGenerate,
      supervisor: async () => ({ next: "intake_extractor", rationale: "again and again" }),
      intakeExtractor: async () => {
        extractorCalls += 1;
        return {};
      },
    });
    const out = await graph.invoke({
      patientId: "pid-1",
      messages: [{ role: "user", content: "loop please" }],
    });
    // dedupe forces ready after the first run; the hop cap is the backstop — never infinite.
    expect(extractorCalls).toBe(1);
    expect(out.answer).toContain("Susan Underwood");
  });

  it("does not let a routed path bypass the verification gate", async () => {
    // A worker was routed, but the model still emits a hallucinated citation — verify must
    // still catch it and degrade, proving generate→verify still runs after routing.
    const badGenerate: GenerateFn = async () => ({
      claims: [{ statement: "Patient takes metformin.", sourceRefs: ["uuid-not-retrieved"] }],
    });
    const graph = buildAgentGraph({
      demographicsTool: foundTool,
      generate: badGenerate,
      supervisor: scriptRouter(["intake_extractor", "ready"]),
      intakeExtractor: async () => ({}),
    });
    const out = await graph.invoke({
      patientId: "pid-1",
      messages: [{ role: "user", content: "meds?" }],
    });
    expect(out.answer).toBe("I can't confirm that from the record.");
    expect(out.verdict?.ok).toBe(false);
  });
});
