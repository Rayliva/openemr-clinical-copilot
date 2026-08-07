import { describe, it, expect } from "vitest";
import type { PatientDemographics } from "@copilot/snapshot";
import { buildAgentGraph } from "../src/graph/graph.js";
import type { DemographicsToolFn, GenerateFn, AllergiesToolFn } from "../src/graph/types.js";

const GRACE: PatientDemographics = {
  id: "pid-grace",
  name: "Grace Bello",
  birthDate: "1990-06-18",
  gender: "female",
  provenance: { sourceTable: "patient_data", rowUuid: "pid-grace", fetchedAt: "2026-07-08T12:00:00.000Z" },
};

const demographicsTool: DemographicsToolFn = async () => ({ found: true, demographics: GRACE });
const noAllergiesTool: AllergiesToolFn = async () => ({ documented: false });

describe("agent graph — critic gate (layer 4) wired", () => {
  it("AC4: withholds an agent-authored action suggestion end-to-end (no prescribing text, note shown)", async () => {
    // The model drafts a low-ferritin finding (fine) AND an action suggestion (must be withheld).
    const generate: GenerateFn = async () => ({
      claims: [
        { statement: "Ferritin is 11 ng/mL (low).", sourceRefs: ["pid-grace"] },
        { statement: "Start her on ferrous sulfate 325 mg daily.", sourceRefs: ["pid-grace"] },
      ],
    });
    const graph = buildAgentGraph({ demographicsTool, allergiesTool: noAllergiesTool, generate });

    const out = await graph.invoke({
      patientId: "pid-grace",
      messages: [{ role: "user", content: "Her ferritin is low — what should I start her on?" }],
    });

    // The grounded finding survives; the directive does not.
    expect(out.answer).toContain("Ferritin is 11 ng/mL (low).");
    expect(out.answer.toLowerCase()).not.toContain("ferrous sulfate");
    expect(out.answer.toLowerCase()).not.toContain("start her on");
    // The withheld note appears and states the boundary, without echoing the withheld text.
    expect(out.answer).toContain("withheld by the safety critic");
    expect(out.answer).toContain("does not recommend treatment or doses");
    // The withheld claim is gone from the citation contract too (built from groundedClaims).
    expect(out.groundedClaims.map((c) => c.statement)).toEqual(["Ferritin is 11 ng/mL (low)."]);
    expect(out.withheld).toHaveLength(1);
    expect(out.withheld[0]!.reason).toBe("unsafe-action-suggestion");
  });

  it("AC4b: when the ONLY claim is an action suggestion, the body degrades and nothing unsafe leaks", async () => {
    const generate: GenerateFn = async () => ({
      claims: [{ statement: "I recommend starting a statin such as atorvastatin 20 mg.", sourceRefs: ["pid-grace"] }],
    });
    const graph = buildAgentGraph({ demographicsTool, allergiesTool: noAllergiesTool, generate });

    const out = await graph.invoke({
      patientId: "pid-grace",
      messages: [{ role: "user", content: "should I start a statin?" }],
    });

    expect(out.answer.toLowerCase()).not.toContain("atorvastatin");
    expect(out.answer.toLowerCase()).not.toContain("i recommend");
    expect(out.answer).toContain("withheld by the safety critic");
    expect(out.groundedClaims).toHaveLength(0);
  });

  it("AC5: a normal grounded turn is unchanged — every kept claim renders, nothing withheld", async () => {
    const generate: GenerateFn = async () => ({
      claims: [
        { statement: "Propranolol 40 mg twice daily is on file.", sourceRefs: ["pid-grace"] },
        { statement: "No preventive migraine medication is documented.", sourceRefs: ["pid-grace"] },
      ],
    });
    const graph = buildAgentGraph({ demographicsTool, allergiesTool: noAllergiesTool, generate });

    const out = await graph.invoke({
      patientId: "pid-grace",
      messages: [{ role: "user", content: "what migraine meds is she on?" }],
    });

    expect(out.answer).toContain("Propranolol 40 mg twice daily is on file.");
    expect(out.answer).toContain("No preventive migraine medication is documented.");
    expect(out.answer).not.toContain("withheld by the safety critic");
    expect(out.withheld).toHaveLength(0);
    expect(out.groundedClaims).toHaveLength(2);
  });

  it("AC6: an injected LLM critic can only tighten (veto extra), and its failure degrades safely", async () => {
    const generate: GenerateFn = async () => ({
      claims: [
        { statement: "Ferritin is 11 ng/mL (low).", sourceRefs: ["pid-grace"] },
        { statement: "Hemoglobin is 11.4 g/dL (low).", sourceRefs: ["pid-grace"] },
      ],
    });
    // A critic that flags the second (kept) claim by index → veto-only removal.
    const vetoSecond = buildAgentGraph({
      demographicsTool,
      allergiesTool: noAllergiesTool,
      generate,
      critic: async () => [1],
    });
    const out = await vetoSecond.invoke({
      patientId: "pid-grace",
      messages: [{ role: "user", content: "labs?" }],
    });
    expect(out.groundedClaims.map((c) => c.statement)).toEqual(["Ferritin is 11 ng/mL (low)."]);
    expect(out.withheld).toHaveLength(1);

    // A throwing critic must not crash the turn — it degrades to the deterministic kept set.
    const throwingCritic = buildAgentGraph({
      demographicsTool,
      allergiesTool: noAllergiesTool,
      generate,
      critic: async () => {
        throw new Error("critic model timeout");
      },
    });
    const out2 = await throwingCritic.invoke({
      patientId: "pid-grace",
      messages: [{ role: "user", content: "labs?" }],
    });
    expect(out2.groundedClaims).toHaveLength(2);
    expect(out2.withheld).toHaveLength(0);
  });
});
