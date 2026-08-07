import { describe, it, expect } from "vitest";
import type { PatientDemographics } from "@copilot/snapshot";
import type { EvidenceSnippet } from "@copilot/rag";
import type { GroundingJudge } from "@copilot/verification";
import { buildAgentGraph } from "../src/graph/graph.js";
import type { DemographicsToolFn, GenerateFn } from "../src/graph/types.js";
import type { RouteTarget, SupervisorRouter } from "../src/graph/supervisor.js";

const SUSAN: PatientDemographics = {
  id: "pid-1",
  name: "Susan Underwood",
  birthDate: "1958-03-14",
  gender: "female",
  provenance: { sourceTable: "patient_data", rowUuid: "pid-1", fetchedAt: "2026-07-14T12:00:00.000Z" },
};
const foundTool: DemographicsToolFn = async () => ({ found: true, demographics: SUSAN });

const GUIDELINE: EvidenceSnippet = {
  chunkId: "t2dm-management::0::0",
  doc: "t2dm-management",
  section: "Glycemic Targets",
  text: "For most non-pregnant adults with type 2 diabetes, a reasonable HbA1c target is below 7%.",
  score: 0.9,
};

function routeTo(seq: readonly RouteTarget[]): SupervisorRouter {
  let i = 0;
  return async () => {
    const next = seq[i] ?? "ready";
    i += 1;
    return { next, rationale: `hop ${i}` };
  };
}

describe("guideline evidence in the answer path", () => {
  it("a claim citing a RETRIEVED guideline chunk passes the gate and appears in the answer", async () => {
    const generate: GenerateFn = async ({ evidence }) => {
      const ref = evidence?.[0]?.chunkId ?? "none";
      return { claims: [{ statement: "The HbA1c target is below 7% for most adults.", sourceRefs: [ref] }] };
    };
    const graph = buildAgentGraph({
      demographicsTool: foundTool,
      generate,
      supervisor: routeTo(["evidence_retriever", "ready"]),
      evidenceRetriever: async () => ({ evidence: [GUIDELINE] }),
    });
    const out = await graph.invoke({
      patientId: "pid-1",
      messages: [{ role: "user", content: "what's her A1c goal per guidelines?" }],
    });
    expect(out.answer).toContain("below 7%");
    expect(out.verdict?.ok).toBe(true);
    expect(out.evidence.map((e) => e.chunkId)).toContain(GUIDELINE.chunkId);
  });

  it("a claim citing a guideline chunk that was NOT retrieved is rejected by the citation check", async () => {
    const generate: GenerateFn = async () => ({
      claims: [{ statement: "The guideline says to start insulin immediately.", sourceRefs: ["fabricated-chunk"] }],
    });
    const graph = buildAgentGraph({
      demographicsTool: foundTool,
      generate,
      supervisor: routeTo(["evidence_retriever", "ready"]),
      evidenceRetriever: async () => ({ evidence: [GUIDELINE] }),
    });
    const out = await graph.invoke({
      patientId: "pid-1",
      messages: [{ role: "user", content: "what does the guideline say?" }],
    });
    expect(out.answer).toBe("I can't confirm that from the record.");
    expect(out.verdict?.ok).toBe(false);
  });

  it("the grounding judge sees the cited chunk's text (can ground a guideline claim)", async () => {
    let evidenceSeenByJudge = "";
    const generate: GenerateFn = async ({ evidence }) => ({
      claims: [{ statement: "HbA1c target is below 7%.", sourceRefs: [evidence?.[0]?.chunkId ?? "none"] }],
    });
    const groundingJudge: GroundingJudge = async ({ evidence }) => {
      evidenceSeenByJudge = evidence.join(" | ");
      return { grounded: evidence.some((e) => e.includes("below 7%")) };
    };
    const graph = buildAgentGraph({
      demographicsTool: foundTool,
      generate,
      groundingJudge,
      supervisor: routeTo(["evidence_retriever", "ready"]),
      evidenceRetriever: async () => ({ evidence: [GUIDELINE] }),
    });
    const out = await graph.invoke({
      patientId: "pid-1",
      messages: [{ role: "user", content: "A1c goal?" }],
    });
    expect(evidenceSeenByJudge).toContain("below 7%"); // judge resolved the guideline chunk
    expect(out.answer).toContain("below 7%");
    expect(out.ungrounded).toHaveLength(0);
  });

  it("a chart-only turn (no evidence) is unchanged — the guideline block never appears", async () => {
    const generate: GenerateFn = async ({ evidence }) => {
      expect(evidence ?? []).toHaveLength(0);
      return { claims: [{ statement: "Patient is Susan Underwood.", sourceRefs: ["pid-1"] }] };
    };
    const graph = buildAgentGraph({ demographicsTool: foundTool, generate });
    const out = await graph.invoke({
      patientId: "pid-1",
      messages: [{ role: "user", content: "who is this?" }],
    });
    expect(out.answer).toContain("Susan Underwood");
    expect(out.evidence).toEqual([]);
  });
});
