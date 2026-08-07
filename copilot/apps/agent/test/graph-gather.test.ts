import { describe, it, expect, vi } from "vitest";
import type { PatientDemographics } from "@copilot/snapshot";
import { buildAgentGraph } from "../src/graph/graph.js";
import type { DemographicsToolFn, GatherFn, GenerateFn } from "../src/graph/types.js";

const SUSAN: PatientDemographics = {
  id: "pid-1",
  name: "Susan Underwood",
  birthDate: "1967-02-08",
  gender: "female",
  provenance: { sourceTable: "patient_data", rowUuid: "pid-1", fetchedAt: "2026-07-08T12:00:00.000Z" },
};
const demographicsTool: DemographicsToolFn = async () => ({ found: true, demographics: SUSAN });

const vitalsFact = {
  documented: true as const,
  observations: [
    {
      name: "Blood pressure",
      value: "120/80",
      unit: "mmHg",
      effectiveDateTime: "2026-06-01T10:00:00Z",
      code: "85354-9",
      provenance: { sourceTable: "form_vitals", rowUuid: "vit-1", fetchedAt: "2026-07-08T12:00:00.000Z" },
    },
  ],
};

describe("agent graph — gather node (agentic optional-tool fetch)", () => {
  it("merges gathered optional facts and lets the answer cite them", async () => {
    const gather: GatherFn = vi.fn(async () => ({ facts: { vitals: vitalsFact }, unavailable: [] }));
    // generate cites the gathered vital row — only resolvable if gather merged it into refs.
    const generate: GenerateFn = async () => ({
      claims: [{ statement: "Blood pressure is 120/80 mmHg.", sourceRefs: ["vit-1"] }],
    });
    const graph = buildAgentGraph({ demographicsTool, generate, gather });

    const out = await graph.invoke({
      patientId: "pid-1",
      messages: [{ role: "user", content: "what is her blood pressure?" }],
    });

    expect(gather).toHaveBeenCalledWith({
      messages: [{ role: "user", content: "what is her blood pressure?" }],
      patientId: "pid-1",
    });
    expect(out.facts?.vitals).toEqual(vitalsFact);
    expect(out.verdict.ok).toBe(true);
    expect(out.answer).toContain("120/80");
  });

  it("runs core-only when no gather is wired (optional facts stay null)", async () => {
    const generate: GenerateFn = async () => ({ claims: [] });
    const graph = buildAgentGraph({ demographicsTool, generate });

    const out = await graph.invoke({
      patientId: "pid-1",
      messages: [{ role: "user", content: "who is she?" }],
    });

    expect(out.facts?.vitals).toBeNull();
    expect(out.facts?.labs).toBeNull();
    expect(out.facts?.immunizations).toBeNull();
  });

  it("merges gather-reported unavailable sources (a failed optional read is not an absence)", async () => {
    const gather: GatherFn = async () => ({ facts: {}, unavailable: ["labs"] });
    const generate: GenerateFn = async () => ({ claims: [] });
    const graph = buildAgentGraph({ demographicsTool, generate, gather });

    const out = await graph.invoke({
      patientId: "pid-1",
      messages: [{ role: "user", content: "what were her labs?" }],
    });

    expect(out.facts?.unavailableSources).toContain("labs");
  });
});
