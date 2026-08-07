import { describe, it, expect } from "vitest";
import type { PatientDemographics } from "@copilot/snapshot";
import type { GroundingJudge } from "@copilot/verification";
import { buildAgentGraph, DEGRADED_ANSWER } from "../src/graph/graph.js";
import type { DemographicsToolFn, GenerateFn, IntakeDocument } from "../src/graph/types.js";
import type { RouteTarget, SupervisorRouter } from "../src/graph/supervisor.js";

const SUSAN: PatientDemographics = {
  id: "pid-1",
  name: "Susan Underwood",
  birthDate: "1958-03-14",
  gender: "female",
  provenance: { sourceTable: "patient_data", rowUuid: "pid-1", fetchedAt: "2026-07-14T12:00:00.000Z" },
};
const foundTool: DemographicsToolFn = async () => ({ found: true, demographics: SUSAN });

const INTAKE_DOC: IntakeDocument = {
  title: "New Patient Intake Form",
  docType: "intake_form",
  provenance: { sourceTable: "documents", rowUuid: "docref-42", fetchedAt: "2026-07-14T12:00:00.000Z" },
};

function routeTo(seq: readonly RouteTarget[]): SupervisorRouter {
  let i = 0;
  return async () => {
    const next = seq[i] ?? "ready";
    i += 1;
    return { next, rationale: `hop ${i}` };
  };
}

describe("intake-extractor documents in the answer path", () => {
  it("routes to intake_extractor for a patient WITH a document: the document reaches state AND generate", async () => {
    let documentsSeenByGenerate: readonly IntakeDocument[] | undefined;
    const generate: GenerateFn = async ({ documents }) => {
      documentsSeenByGenerate = documents;
      const ref = documents?.[0]?.provenance.rowUuid ?? "none";
      return { claims: [{ statement: "An intake form is on file.", sourceRefs: [ref] }] };
    };
    const graph = buildAgentGraph({
      demographicsTool: foundTool,
      generate,
      supervisor: routeTo(["intake_extractor", "ready"]),
      intakeExtractor: async () => ({ documents: [INTAKE_DOC] }),
    });
    const out = await graph.invoke({
      patientId: "pid-1",
      messages: [{ role: "user", content: "is there an intake form on file?" }],
    });
    // Before the fix, the worker output was discarded: generate saw nothing and the state carried
    // nothing. Now the document reaches both.
    expect(documentsSeenByGenerate?.map((d) => d.title)).toContain(INTAKE_DOC.title);
    expect(out.documents.map((d) => d.provenance.rowUuid)).toContain(INTAKE_DOC.provenance.rowUuid);
  });

  it("a claim citing the document's DocumentReference provenance passes the citation check", async () => {
    const generate: GenerateFn = async ({ documents }) => ({
      claims: [
        {
          statement: `Document on file: ${documents?.[0]?.title ?? "?"}.`,
          sourceRefs: [documents?.[0]?.provenance.rowUuid ?? "none"],
        },
      ],
    });
    const graph = buildAgentGraph({
      demographicsTool: foundTool,
      generate,
      supervisor: routeTo(["intake_extractor", "ready"]),
      intakeExtractor: async () => ({ documents: [INTAKE_DOC] }),
    });
    const out = await graph.invoke({
      patientId: "pid-1",
      messages: [{ role: "user", content: "what documents are on file?" }],
    });
    expect(out.verdict?.ok).toBe(true);
    expect(out.answer).toContain(INTAKE_DOC.title);
  });

  it("a claim citing a document ref that was NOT retrieved is rejected by the citation check", async () => {
    const generate: GenerateFn = async () => ({
      claims: [{ statement: "A discharge summary is on file.", sourceRefs: ["fabricated-docref"] }],
    });
    const graph = buildAgentGraph({
      demographicsTool: foundTool,
      generate,
      supervisor: routeTo(["intake_extractor", "ready"]),
      intakeExtractor: async () => ({ documents: [INTAKE_DOC] }),
    });
    const out = await graph.invoke({
      patientId: "pid-1",
      messages: [{ role: "user", content: "what documents are on file?" }],
    });
    expect(out.answer).toBe(DEGRADED_ANSWER);
    expect(out.verdict?.ok).toBe(false);
  });

  it("the grounding judge sees the cited document's text (can ground a document claim)", async () => {
    let evidenceSeenByJudge = "";
    const generate: GenerateFn = async ({ documents }) => ({
      claims: [
        {
          statement: "An intake form is on file.",
          sourceRefs: [documents?.[0]?.provenance.rowUuid ?? "none"],
        },
      ],
    });
    const groundingJudge: GroundingJudge = async ({ evidence }) => {
      evidenceSeenByJudge = evidence.join(" | ");
      return { grounded: evidence.some((e) => e.toLowerCase().includes("intake")) };
    };
    const graph = buildAgentGraph({
      demographicsTool: foundTool,
      generate,
      groundingJudge,
      supervisor: routeTo(["intake_extractor", "ready"]),
      intakeExtractor: async () => ({ documents: [INTAKE_DOC] }),
    });
    const out = await graph.invoke({
      patientId: "pid-1",
      messages: [{ role: "user", content: "any intake form?" }],
    });
    expect(evidenceSeenByJudge.toLowerCase()).toContain("intake"); // judge resolved the document ref
    expect(out.answer).toContain("intake form is on file");
    expect(out.ungrounded).toHaveLength(0);
  });

  it("when the extractor ran but found no documents, generate is told (empty list) — not fabricated", async () => {
    let called = false;
    let documentsField: readonly IntakeDocument[] | undefined;
    const generate: GenerateFn = async ({ documents }) => {
      called = true;
      documentsField = documents;
      // With no document facts, the model returns no claims — the turn degrades honestly.
      return { claims: [] };
    };
    const graph = buildAgentGraph({
      demographicsTool: foundTool,
      generate,
      supervisor: routeTo(["intake_extractor", "ready"]),
      intakeExtractor: async () => ({ documents: [] }),
    });
    const out = await graph.invoke({
      patientId: "pid-1",
      messages: [{ role: "user", content: "is there an intake form?" }],
    });
    expect(called).toBe(true);
    // Present-but-empty: "we looked, found none" — distinct from not-looked-up (undefined).
    expect(documentsField).toEqual([]);
    expect(out.documents).toEqual([]);
    expect(out.answer).toBe(DEGRADED_ANSWER);
  });

  it("a chart-only turn does NOT pass documents to generate (undefined = never looked up)", async () => {
    let documentsField: readonly IntakeDocument[] | undefined = [INTAKE_DOC];
    const generate: GenerateFn = async ({ documents }) => {
      documentsField = documents;
      return { claims: [{ statement: "Patient is Susan Underwood.", sourceRefs: ["pid-1"] }] };
    };
    const graph = buildAgentGraph({ demographicsTool: foundTool, generate });
    const out = await graph.invoke({
      patientId: "pid-1",
      messages: [{ role: "user", content: "who is this?" }],
    });
    expect(documentsField).toBeUndefined();
    expect(out.documents).toEqual([]);
    expect(out.answer).toContain("Susan Underwood");
  });
});
