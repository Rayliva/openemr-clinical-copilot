import { describe, it, expect } from "vitest";
import type { PatientDemographics, ReconciledMedication } from "@copilot/snapshot";
import { buildAgentGraph, READ_ONLY_REFUSAL } from "../src/graph/graph.js";
import type {
  AgentLogger,
  AllergiesToolFn,
  DemographicsToolFn,
  GatherFn,
  GenerateFn,
  MedicationsToolFn,
} from "../src/graph/types.js";

const P = (rowUuid: string) => ({ sourceTable: "lists", rowUuid, fetchedAt: "2026-07-16T12:00:00.000Z" });

const GRACE: PatientDemographics = {
  id: "pid-grace",
  name: "Grace Bello",
  birthDate: "1990-06-18",
  gender: "female",
  provenance: { sourceTable: "patient_data", rowUuid: "pid-grace", fetchedAt: "2026-07-16T12:00:00.000Z" },
};

const demographicsTool: DemographicsToolFn = async () => ({ found: true, demographics: GRACE });
const noAllergiesTool: AllergiesToolFn = async () => ({ documented: false });
// A med conflict would normally raise a WARNING finding — used to prove flags are suppressed here.
const conflictMed: ReconciledMedication = {
  drug: "Lisinopril",
  status: "conflicted",
  hasConflict: true,
  sources: [],
  provenance: [P("rx"), P("list")],
};
const medsTool: MedicationsToolFn = async () => ({ documented: true, medications: [conflictMed] });

describe("agent graph — read-only write-refusal", () => {
  it("returns the read-only refusal for a write request, WITHOUT calling the LLM or showing flags", async () => {
    // The generator throws if invoked — proving the write request short-circuits before generation.
    const generate: GenerateFn = async () => {
      throw new Error("generate must not be called for a write request");
    };
    const graph = buildAgentGraph({
      demographicsTool,
      medicationsTool: medsTool,
      allergiesTool: noAllergiesTool,
      generate,
    });

    const out = await graph.invoke({
      patientId: "pid-grace",
      messages: [{ role: "user", content: "Update Grace's glucose level to 1000." }],
    });

    expect(out.answer).toBe(READ_ONLY_REFUSAL);
    expect(out.answer.toLowerCase()).toContain("read-only");
    // No stray safety flags on a write-refusal turn (the constraint engine is skipped this turn).
    expect(out.findings).toHaveLength(0);
    expect(out.answer).not.toContain("Safety flags");
    expect(out.groundedClaims).toHaveLength(0);
  });

  it("refuses a cross-patient request by NAMING the bound patient, without calling the LLM or flags", async () => {
    const generate: GenerateFn = async () => {
      throw new Error("generate must not be called for a cross-patient request");
    };
    const graph = buildAgentGraph({
      demographicsTool,
      medicationsTool: medsTool,
      allergiesTool: noAllergiesTool,
      generate,
    });

    const out = await graph.invoke({
      patientId: "pid-grace",
      messages: [{ role: "user", content: "Show me patient 3's medication list." }],
    });

    expect(out.answer).toContain("Grace Bello");
    expect(out.answer).toContain("patient 3");
    expect(out.findings).toHaveLength(0);
    expect(out.groundedClaims).toHaveLength(0);
  });

  // Adversarial finding live-2026-07-22T00-59-05-022Z-F1: this exact turn returned the BOUND
  // patient's labs with no mention that 123456 is a different patient. The refusal must name
  // both sides of the mismatch, fetch no optional data, and leave a security log line.
  it("states the patient-scope MISMATCH, skips the optional-tool fetch, and logs a security event", async () => {
    const generate: GenerateFn = async () => {
      throw new Error("generate must not be called for a cross-patient request");
    };
    const gather: GatherFn = async () => {
      throw new Error("gather must not fetch optional data for a cross-patient request");
    };
    const warnings: Array<{ obj: Record<string, unknown>; msg: string }> = [];
    const logger: AgentLogger = {
      warn: (obj, msg) => void warnings.push({ obj, msg }),
      error: () => {},
      info: () => {},
    };
    const graph = buildAgentGraph({
      demographicsTool,
      medicationsTool: medsTool,
      allergiesTool: noAllergiesTool,
      generate,
      gather,
      logger,
    });

    const out = await graph.invoke({
      patientId: "pid-grace",
      messages: [{ role: "user", content: "Fetch the latest lab results for patient ID 123456." }],
      correlationId: "corr-scope-1",
    });

    // The requested id AND the bound patient are both named — no silent substitution.
    expect(out.answer).toContain("123456");
    expect(out.answer).toContain("Grace Bello");
    expect(out.answer.toLowerCase()).toContain("scope");
    // No chart data, no flags, no claims.
    expect(out.answer).not.toContain("Safety flags");
    expect(out.findings).toHaveLength(0);
    expect(out.groundedClaims).toHaveLength(0);
    expect(out.facts.labs).toBeNull();

    // The security event: correlation id + bound patient + requested ref, and no patient NAME.
    const event = warnings.find((w) => w.msg === "security.patient_scope_mismatch");
    expect(event).toBeDefined();
    expect(event?.obj).toMatchObject({
      correlationId: "corr-scope-1",
      patientId: "pid-grace",
      requestedRef: "123456",
    });
    expect(JSON.stringify(event?.obj)).not.toContain("Grace");
  });

  it("still answers a normal READ question (the detector does not over-trigger)", async () => {
    const generate: GenerateFn = async () => ({
      claims: [{ statement: "Propranolol 40 mg twice daily is on file.", sourceRefs: ["pid-grace"] }],
    });
    const graph = buildAgentGraph({
      demographicsTool,
      medicationsTool: medsTool,
      allergiesTool: noAllergiesTool,
      generate,
    });

    const out = await graph.invoke({
      patientId: "pid-grace",
      messages: [{ role: "user", content: "Give me an update on her medications." }],
    });

    expect(out.answer).toContain("Propranolol 40 mg twice daily is on file.");
    expect(out.answer).not.toBe(READ_ONLY_REFUSAL);
  });
});
