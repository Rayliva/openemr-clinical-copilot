import { describe, it, expect } from "vitest";
import { createMetricsRegistry } from "@copilot/metrics";
import type { PatientDemographics } from "@copilot/snapshot";
import type { GroundingJudge } from "@copilot/verification";
import { buildAgentGraph } from "../src/graph/graph.js";
import type { DemographicsToolFn, GenerateFn } from "../src/graph/types.js";

const SUSAN: PatientDemographics = {
  id: "pid-1",
  name: "Susan Underwood",
  birthDate: "1967-02-08",
  gender: "female",
  provenance: { sourceTable: "patient_data", rowUuid: "pid-1", fetchedAt: "2026-07-08T12:00:00.000Z" },
};

const foundTool: DemographicsToolFn = async () => ({ found: true, demographics: SUSAN });
const notFoundTool: DemographicsToolFn = async () => ({ found: false });

describe("agent graph", () => {
  it("assembles context, generates, verifies, and responds with a grounded answer", async () => {
    const generate: GenerateFn = async () => ({
      claims: [{ statement: "Patient is Susan Underwood, DOB 1967-02-08.", sourceRefs: ["pid-1"] }],
    });
    const graph = buildAgentGraph({ demographicsTool: foundTool, generate });

    const out = await graph.invoke({
      patientId: "pid-1",
      messages: [{ role: "user", content: "who is this patient?" }],
    });

    expect(out.answer).toContain("Susan Underwood");
    expect(out.verdict?.ok).toBe(true);
  });

  it("degrades when the model emits a hallucinated citation (verify catches it)", async () => {
    const generate: GenerateFn = async () => ({
      claims: [{ statement: "Patient takes metformin.", sourceRefs: ["uuid-not-retrieved"] }],
    });
    const graph = buildAgentGraph({ demographicsTool: foundTool, generate });

    const out = await graph.invoke({
      patientId: "pid-1",
      messages: [{ role: "user", content: "what meds?" }],
    });

    expect(out.answer).toBe("I can't confirm that from the record.");
    expect(out.verdict?.ok).toBe(false);
  });

  it("drops a citation-verified claim the grounding judge finds unsupported (layer 2)", async () => {
    // The claim cites a real retrieved row (passes layer 1) but over-claims meds the
    // demographics evidence cannot support — the grounding judge must drop it.
    const generate: GenerateFn = async () => ({
      claims: [{ statement: "Patient takes metformin.", sourceRefs: ["pid-1"] }],
    });
    const groundingJudge: GroundingJudge = async ({ statement }) => ({
      grounded: !statement.includes("metformin"),
      reason: "the cited row does not mention metformin",
    });
    const graph = buildAgentGraph({ demographicsTool: foundTool, generate, groundingJudge });

    const out = await graph.invoke({
      patientId: "pid-1",
      messages: [{ role: "user", content: "what meds?" }],
    });

    // Body degrades (the only claim was dropped) and the note reports an omission...
    expect(out.answer).toContain("I can't confirm that from the record.");
    expect(out.answer.toLowerCase()).toContain("could not be verified");
    expect(out.answer).toContain("omitted");
    // ...but must NOT echo the model's raw unverified (potentially fabricated) statement.
    expect(out.answer).not.toContain("Patient takes metformin");
    expect(out.ungrounded).toHaveLength(1);
  });

  it("regenerates with the judge's feedback and salvages a grounded answer (AC-R8)", async () => {
    // First attempt over-claims meds; given the judge's reason on retry, the model
    // corrects to a supported claim — the answer recovers rather than degrading, and
    // the retry is counted (the real source for retries_total).
    const metrics = createMetricsRegistry();
    let feedbackSeen: unknown;
    const generate: GenerateFn = async ({ feedback }) => {
      if (feedback === undefined) {
        return { claims: [{ statement: "Patient takes metformin.", sourceRefs: ["pid-1"] }] };
      }
      feedbackSeen = feedback;
      return {
        claims: [{ statement: "Patient is Susan Underwood, DOB 1967-02-08.", sourceRefs: ["pid-1"] }],
      };
    };
    const groundingJudge: GroundingJudge = async ({ statement }) => ({
      grounded: !statement.includes("metformin"),
      reason: "the cited row does not mention metformin",
    });
    const graph = buildAgentGraph({
      demographicsTool: foundTool,
      generate,
      groundingJudge,
      metrics,
    });

    const out = await graph.invoke({
      patientId: "pid-1",
      messages: [{ role: "user", content: "who is this?" }],
    });

    expect(out.answer).toContain("Susan Underwood");
    expect(out.answer).not.toContain("Could not verify");
    expect(out.answer).not.toContain("metformin");
    expect(out.ungrounded).toHaveLength(0);
    // The regenerate step received the judge's reason as feedback...
    expect(feedbackSeen).toEqual([
      { statement: "Patient takes metformin.", reason: "the cited row does not mention metformin" },
    ]);
    // ...and the retry is recorded to the live window.
    expect(metrics.snapshot().retriesTotal).toBe(1);
    expect(metrics.snapshot().retryPathImplemented).toBe(true);
  });

  it("keeps a claim the grounding judge supports (layer 2)", async () => {
    const generate: GenerateFn = async () => ({
      claims: [{ statement: "Patient is Susan Underwood, DOB 1967-02-08.", sourceRefs: ["pid-1"] }],
    });
    const groundingJudge: GroundingJudge = async () => ({ grounded: true });
    const graph = buildAgentGraph({ demographicsTool: foundTool, generate, groundingJudge });

    const out = await graph.invoke({
      patientId: "pid-1",
      messages: [{ role: "user", content: "who is this?" }],
    });

    expect(out.answer).toContain("Susan Underwood");
    expect(out.answer).not.toContain("Could not verify");
    expect(out.ungrounded).toHaveLength(0);
  });

  it("does not invent facts for a no-data patient", async () => {
    const generate: GenerateFn = async () => ({ claims: [] });
    const graph = buildAgentGraph({ demographicsTool: notFoundTool, generate });

    const out = await graph.invoke({
      patientId: "ghost",
      messages: [{ role: "user", content: "who?" }],
    });

    expect(out.answer).toBe("I can't confirm that from the record.");
  });
});
