import { describe, it, expect } from "vitest";
import { buildSupervisorPrompt, constrainToAvailable } from "../src/anthropic/claudeSupervisor.js";

describe("buildSupervisorPrompt", () => {
  it("lists only the available workers and notes already-used ones", () => {
    const p = buildSupervisorPrompt(["evidence_retriever"], ["evidence_retriever"]);
    expect(p).toContain("evidence_retriever");
    expect(p).not.toContain("intake_extractor"); // not available → not offered
    expect(p.toLowerCase()).toMatch(/already/);
    expect(p.toLowerCase()).toContain("ready");
  });

  it("mentions the chart is always loaded (so it does not route for chart questions)", () => {
    const p = buildSupervisorPrompt(["evidence_retriever", "intake_extractor"], []);
    expect(p.toLowerCase()).toMatch(/chart.*(already|loaded)/);
    expect(p).toContain("intake_extractor");
  });
});

describe("constrainToAvailable", () => {
  it("passes through a decision for an available worker", () => {
    const out = constrainToAvailable({ next: "evidence_retriever", rationale: "guideline q" }, ["evidence_retriever"]);
    expect(out.next).toBe("evidence_retriever");
  });

  it("forces ready when the model picks an UNAVAILABLE worker (never routes to a no-op)", () => {
    const out = constrainToAvailable({ next: "intake_extractor", rationale: "x" }, ["evidence_retriever"]);
    expect(out.next).toBe("ready");
  });

  it("passes ready through, and degrades unparseable output to ready", () => {
    expect(constrainToAvailable({ next: "ready", rationale: "chart answers it" }, []).next).toBe("ready");
    expect(constrainToAvailable({ nonsense: true }, ["evidence_retriever"]).next).toBe("ready");
  });
});
