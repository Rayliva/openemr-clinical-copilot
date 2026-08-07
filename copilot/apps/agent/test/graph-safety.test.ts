import { describe, it, expect } from "vitest";
import type { PatientDemographics, ReconciledMedication } from "@copilot/snapshot";
import { buildAgentGraph } from "../src/graph/graph.js";
import type {
  AllergiesToolFn,
  DemographicsToolFn,
  GenerateFn,
  MedicationsToolFn,
} from "../src/graph/types.js";

const P = (rowUuid: string) => ({ sourceTable: "lists", rowUuid, fetchedAt: "2026-07-08T12:00:00.000Z" });

const SUSAN: PatientDemographics = {
  id: "pid-1",
  name: "Susan Underwood",
  birthDate: "1967-02-08",
  gender: "female",
  provenance: { sourceTable: "patient_data", rowUuid: "pid-1", fetchedAt: "2026-07-08T12:00:00.000Z" },
};

const LISINOPRIL_CONFLICT: ReconciledMedication = {
  drug: "Lisinopril",
  status: "conflicted",
  hasConflict: true,
  sources: [],
  provenance: [P("rx-lis"), P("list-lis")],
};
const METFORMIN: ReconciledMedication = {
  drug: "Metformin",
  status: "active",
  hasConflict: false,
  sources: [],
  provenance: [P("list-met")],
};

const demographicsTool: DemographicsToolFn = async () => ({ found: true, demographics: SUSAN });
const medsTool: MedicationsToolFn = async () => ({
  documented: true,
  medications: [LISINOPRIL_CONFLICT, METFORMIN],
});
const noAllergiesTool: AllergiesToolFn = async () => ({ documented: false });

describe("agent graph — constraint engine (layer 3) wired", () => {
  it("surfaces Susan's med conflict + undocumented-allergy safety flags", async () => {
    const generate: GenerateFn = async () => ({
      claims: [{ statement: "Patient is Susan Underwood.", sourceRefs: ["pid-1"] }],
    });
    const graph = buildAgentGraph({ demographicsTool, medicationsTool: medsTool, allergiesTool: noAllergiesTool, generate });

    const out = await graph.invoke({
      patientId: "pid-1",
      messages: [{ role: "user", content: "is it safe to renew her meds?" }],
    });

    const codes = out.findings.map((f) => f.code).sort();
    expect(codes).toEqual(["allergy-status-unknown", "medication-status-conflict"]);
    expect(out.answer).toContain("Lisinopril");
    expect(out.answer.toLowerCase()).toContain("safety");
  });

  it("surfaces an allergy-contraindication end-to-end (active med matches a documented allergy)", async () => {
    // The scariest finding the engine can emit, proven to reach the answer body.
    const amoxTool: MedicationsToolFn = async () => ({
      documented: true,
      medications: [
        { drug: "Amoxicillin", status: "active", hasConflict: false, sources: [], provenance: [P("rx-amox")] },
      ],
    });
    const penicillinAllergyTool: AllergiesToolFn = async () => ({
      documented: true,
      allergies: [{ substance: "Penicillin", provenance: P("alg-pcn") }],
    });
    const generate: GenerateFn = async () => ({ claims: [] });
    const graph = buildAgentGraph({
      demographicsTool,
      medicationsTool: amoxTool,
      allergiesTool: penicillinAllergyTool,
      generate,
    });

    const out = await graph.invoke({
      patientId: "pid-1",
      messages: [{ role: "user", content: "can I renew her amoxicillin?" }],
    });

    expect(out.findings.map((f) => f.code)).toContain("allergy-contraindication");
    expect(out.answer).toContain("Amoxicillin");
    expect(out.answer.toLowerCase()).toContain("allergy");
  });

  it("fires the unavailable-allergy guard when the allergy READ fails (not treated as no-allergies)", async () => {
    // Regression for the null-collapse safety inversion: a failed allergy read must
    // still warn, never silently produce zero allergy signalling.
    const failingAllergies: AllergiesToolFn = async () => {
      throw new Error("fhir request failed with status 500");
    };
    const generate: GenerateFn = async () => ({ claims: [] });
    const graph = buildAgentGraph({
      demographicsTool,
      medicationsTool: medsTool,
      allergiesTool: failingAllergies,
      generate,
    });

    const out = await graph.invoke({
      patientId: "pid-1",
      messages: [{ role: "user", content: "any allergies before I prescribe?" }],
    });

    const guard = out.findings.filter((f) => f.code === "allergy-status-unknown");
    expect(guard).toHaveLength(1);
    expect(guard[0]!.message.toLowerCase()).toContain("could not");
  });

  it("verifies a model claim that cites a medication provenance row", async () => {
    const generate: GenerateFn = async () => ({
      claims: [{ statement: "Lisinopril status is unclear across sources.", sourceRefs: ["rx-lis"] }],
    });
    const graph = buildAgentGraph({ demographicsTool, medicationsTool: medsTool, allergiesTool: noAllergiesTool, generate });

    const out = await graph.invoke({
      patientId: "pid-1",
      messages: [{ role: "user", content: "what about lisinopril?" }],
    });

    expect(out.verdict.ok).toBe(true);
    expect(out.answer).toContain("Lisinopril status is unclear");
  });

  it("renders grouped claims as a titled bullet block in the answer body", async () => {
    const generate: GenerateFn = async () => ({
      claims: [
        { statement: "Lisinopril — status unclear", sourceRefs: ["rx-lis"], group: "Medications" },
        { statement: "Metformin 500 mg", sourceRefs: ["list-met"], group: "Medications" },
      ],
    });
    const graph = buildAgentGraph({ demographicsTool, medicationsTool: medsTool, allergiesTool: noAllergiesTool, generate });

    const out = await graph.invoke({
      patientId: "pid-1",
      messages: [{ role: "user", content: "what meds is she on?" }],
    });

    // The grouped claims collapse to one header + bullets — not two repeated sentences.
    expect(out.answer).toContain("Medications\n- Lisinopril — status unclear\n- Metformin 500 mg");
    // group is inert to the gate: both claims still verify against their cited rows.
    expect(out.verdict.ok).toBe(true);
  });

  it("degrades gracefully when generate throws — never crashes the turn, safety flags survive", async () => {
    const generate: GenerateFn = async () => {
      throw new Error("boom: transient LLM failure");
    };
    const graph = buildAgentGraph({ demographicsTool, medicationsTool: medsTool, allergiesTool: noAllergiesTool, generate });

    const out = await graph.invoke({
      patientId: "pid-1",
      messages: [{ role: "user", content: "what meds?" }],
    });

    // The turn resolves (no throw) and degrades honestly; the deterministic safety
    // findings still surface because they are computed from structured facts.
    expect(out.answer).toContain("I can only answer from this patient's chart");
    expect(out.findings.length).toBeGreaterThan(0);
    expect(out.answer).toContain("Lisinopril");
  });

  it("surfaces safety findings even when the answer degrades (no verified claims)", async () => {
    const generate: GenerateFn = async () => ({ claims: [] });
    const graph = buildAgentGraph({ demographicsTool, medicationsTool: medsTool, allergiesTool: noAllergiesTool, generate });

    const out = await graph.invoke({
      patientId: "pid-1",
      messages: [{ role: "user", content: "anything I should know?" }],
    });

    expect(out.findings.length).toBeGreaterThan(0);
    expect(out.answer).toContain("I can only answer from this patient's chart");
    expect(out.answer).toContain("Lisinopril");
  });
});
