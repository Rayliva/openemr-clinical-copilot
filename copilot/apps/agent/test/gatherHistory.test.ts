import { describe, expect, it } from "vitest";
import { sanitizeGatherHistory } from "../src/graph/gather.js";

describe("sanitizeGatherHistory (gather-history-not-a-source spec)", () => {
  const history = [
    { role: "user" as const, content: "Give me a patient summary." },
    {
      role: "assistant" as const,
      content: "Immunizations: Influenza vaccine completed 2025-10-01; Tdap 2019-05-10.",
    },
    { role: "user" as const, content: "when did she get her flu shot" },
  ];

  it("strips chart data from assistant turns so gather cannot read the answer from prose (AC1)", () => {
    const out = sanitizeGatherHistory(history);
    const assistantTurn = out[1];
    expect(assistantTurn?.role).toBe("assistant");
    expect(assistantTurn?.content).not.toContain("2025-10-01");
    expect(assistantTurn?.content).not.toContain("Influenza");
    expect(assistantTurn?.content.length).toBeGreaterThan(0);
  });

  it("passes user turns through unchanged and in order (AC2)", () => {
    const out = sanitizeGatherHistory(history);
    expect(out[0]).toEqual({ role: "user", content: "Give me a patient summary." });
    expect(out[2]).toEqual({ role: "user", content: "when did she get her flu shot" });
  });

  it("preserves the role sequence (AC3)", () => {
    const out = sanitizeGatherHistory(history);
    expect(out.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });

  it("is a no-op shape for a single user message", () => {
    const out = sanitizeGatherHistory([{ role: "user", content: "what are her labs?" }]);
    expect(out).toEqual([{ role: "user", content: "what are her labs?" }]);
  });
});
