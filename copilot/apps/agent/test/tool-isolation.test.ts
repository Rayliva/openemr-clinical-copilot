import { describe, it, expect } from "vitest";
import type { PatientDemographics } from "@copilot/snapshot";
import { createMetricsRegistry } from "@copilot/metrics";
import { buildAgentGraph } from "../src/graph/graph.js";
import type {
  DemographicsToolFn,
  GenerateFn,
  MedicationsToolFn,
  ProblemsToolFn,
} from "../src/graph/types.js";

/**
 * Per-tool isolation + the unavailable-vs-absent distinction.
 * Spec: docs/specs/observability-dashboard.md (AC3, AC4) and the load test's #2 fix.
 */

const SUSAN: PatientDemographics = {
  id: "pid-1",
  name: "Susan Underwood",
  birthDate: "1967-02-08",
  gender: "female",
  provenance: { sourceTable: "patient_data", rowUuid: "pid-1", fetchedAt: "2026-07-08T12:00:00.000Z" },
};

const foundTool: DemographicsToolFn = async () => ({ found: true, demographics: SUSAN });
const generate: GenerateFn = async () => ({
  claims: [{ statement: "Patient is Susan Underwood.", sourceRefs: ["pid-1"] }],
});

const failingMeds: MedicationsToolFn = async () => {
  throw new Error("fhir request failed with status 500");
};
const emptyProblems: ProblemsToolFn = async () => ({ documented: false });

describe("tool isolation", () => {
  it("does not fail the turn when a single tool read fails", async () => {
    const graph = buildAgentGraph({
      demographicsTool: foundTool,
      medicationsTool: failingMeds,
      generate,
    });

    const out = await graph.invoke({
      patientId: "pid-1",
      messages: [{ role: "user", content: "who is this patient?" }],
    });

    // The turn degrades to a partial answer rather than throwing.
    expect(out.answer).toContain("Susan Underwood");
  });

  it("marks a failed read as unavailable, not as a documented absence (AC4)", async () => {
    const graph = buildAgentGraph({
      demographicsTool: foundTool,
      medicationsTool: failingMeds,
      problemsTool: emptyProblems,
      generate,
    });

    const out = await graph.invoke({
      patientId: "pid-1",
      messages: [{ role: "user", content: "what meds is she on?" }],
    });

    // A failed medication read must be distinguishable from "no meds documented".
    expect(out.facts?.unavailableSources).toContain("medications");
    // ...and an empty-but-successful read must NOT be marked unavailable.
    expect(out.facts?.unavailableSources).not.toContain("problems");
  });

  it("logs a structured line at the failed-read boundary (visible without the tracer)", async () => {
    const logged: Array<{ obj: Record<string, unknown>; msg: string }> = [];
    const logger = {
      warn: (obj: Record<string, unknown>, msg: string) => logged.push({ obj, msg }),
      error: (obj: Record<string, unknown>, msg: string) => logged.push({ obj, msg }),
    };
    const graph = buildAgentGraph({
      demographicsTool: foundTool,
      medicationsTool: failingMeds,
      generate,
      logger,
    });

    await graph.invoke({
      patientId: "pid-1",
      messages: [{ role: "user", content: "what meds is she on?" }],
    });

    const medFailure = logged.find((l) => l.obj.source === "medications");
    expect(medFailure).toBeDefined();
    expect(medFailure!.msg).toContain("read failed");
  });

  it("records per-tool call counts and attributes the failure to that tool (AC3)", async () => {
    const metrics = createMetricsRegistry();
    const graph = buildAgentGraph({
      demographicsTool: foundTool,
      medicationsTool: failingMeds,
      problemsTool: emptyProblems,
      generate,
      metrics,
    });

    await graph.invoke({
      patientId: "pid-1",
      messages: [{ role: "user", content: "what meds is she on?" }],
    });

    const snapshot = metrics.snapshot();
    expect(snapshot.tools.medications).toMatchObject({ callsTotal: 1, failuresTotal: 1 });
    expect(snapshot.tools.problems).toMatchObject({ callsTotal: 1, failuresTotal: 0 });
    expect(snapshot.tools.demographics).toMatchObject({ callsTotal: 1, failuresTotal: 0 });
  });
});
