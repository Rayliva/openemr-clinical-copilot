import { describe, it, expect } from "vitest";
import type { Claim } from "@copilot/verification";
import { renderAnswerBody } from "../src/graph/renderAnswer.js";

describe("renderAnswerBody — grouped vs prose composition", () => {
  it("renders a single ungrouped claim as its bare statement (no regression)", () => {
    const claims: Claim[] = [{ statement: "Lisinopril status is unclear across sources.", sourceRefs: ["rx-1"] }];
    expect(renderAnswerBody(claims)).toBe("Lisinopril status is unclear across sources.");
  });

  it("joins multiple ungrouped claims with a single space (prose paragraph)", () => {
    const claims: Claim[] = [
      { statement: "She is due for a flu shot.", sourceRefs: ["a"] },
      { statement: "Confirm her renal function first.", sourceRefs: ["b"] },
    ];
    expect(renderAnswerBody(claims)).toBe("She is due for a flu shot. Confirm her renal function first.");
  });

  it("renders a group of 2+ items as a titled bullet block", () => {
    const claims: Claim[] = [
      { statement: "Lisinopril 10 mg", sourceRefs: ["rx-lis"], group: "Active medications" },
      { statement: "Metformin 500 mg", sourceRefs: ["list-met"], group: "Active medications" },
    ];
    expect(renderAnswerBody(claims)).toBe(
      "Active medications\n- Lisinopril 10 mg\n- Metformin 500 mg",
    );
  });

  it("renders a single-item group inline (a sentence, not a one-bullet list)", () => {
    const claims: Claim[] = [
      { statement: "Sumatriptan 50 mg PRN", sourceRefs: ["rx-suma"], group: "Active medications" },
    ];
    expect(renderAnswerBody(claims)).toBe("Active medications: Sumatriptan 50 mg PRN");
  });

  it("strips a trailing status the group header already conveys", () => {
    const claims: Claim[] = [
      { statement: "Sumatriptan 50 mg PRN — active", sourceRefs: ["rx-suma"], group: "Active medications" },
      { statement: "Lisinopril 10 mg (active)", sourceRefs: ["rx-lis"], group: "Active medications" },
    ];
    expect(renderAnswerBody(claims)).toBe(
      "Active medications\n- Sumatriptan 50 mg PRN\n- Lisinopril 10 mg",
    );
  });

  it("keeps the status when the header does NOT convey it", () => {
    const claims: Claim[] = [
      { statement: "Lisinopril 10 mg — stopped", sourceRefs: ["rx-lis"], group: "Medications" },
      { statement: "Metformin 500 mg — active", sourceRefs: ["m-1"], group: "Medications" },
    ];
    expect(renderAnswerBody(claims)).toBe(
      "Medications\n- Lisinopril 10 mg — stopped\n- Metformin 500 mg — active",
    );
  });

  it("buckets by group in first-appearance order even when interleaved", () => {
    const claims: Claim[] = [
      { statement: "Penicillin", sourceRefs: ["alg-1"], group: "Allergies" },
      { statement: "Lisinopril 10 mg", sourceRefs: ["rx-1"], group: "Active medications" },
      { statement: "Sulfa", sourceRefs: ["alg-2"], group: "Allergies" },
    ];
    expect(renderAnswerBody(claims)).toBe(
      "Allergies\n- Penicillin\n- Sulfa\n\nActive medications: Lisinopril 10 mg",
    );
  });

  it("leads with the prose paragraph, then group blocks, separated by a blank line", () => {
    const claims: Claim[] = [
      { statement: "She is overdue for A1c.", sourceRefs: ["p-1"] },
      { statement: "Metformin 500 mg", sourceRefs: ["m-1"], group: "Active medications" },
    ];
    expect(renderAnswerBody(claims)).toBe(
      "She is overdue for A1c.\n\nActive medications: Metformin 500 mg",
    );
  });

  it("treats a blank/whitespace group as ungrouped (prose)", () => {
    const claims: Claim[] = [
      { statement: "Just one fact.", sourceRefs: ["x"], group: "   " },
    ];
    expect(renderAnswerBody(claims)).toBe("Just one fact.");
  });
});
