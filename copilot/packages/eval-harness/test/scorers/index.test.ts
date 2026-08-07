import { describe, it, expect } from "vitest";
import { allScorers } from "../../src/scorers/index.js";
import { makeCase, makeOutput, makeCitation } from "./helpers.js";
import type { RubricCategory } from "../../src/contracts.js";

/** How the runner (T4) applies every scorer and merges the partial maps into one CaseResult. */
function scoreAll(
  output: ReturnType<typeof makeOutput>,
  gc: ReturnType<typeof makeCase>,
): Partial<Record<RubricCategory, boolean>> {
  return allScorers.reduce<Partial<Record<RubricCategory, boolean>>>(
    (acc, scorer) => ({ ...acc, ...scorer(output, gc) }),
    {},
  );
}

describe("allScorers barrel", () => {
  it("exposes exactly the five rubric scorers", () => {
    expect(allScorers).toHaveLength(5);
  });

  it("only the categories a case lists appear in the merged result", () => {
    const merged = scoreAll(
      makeOutput({ refused: true }),
      makeCase({ category: ["safe_refusal"], expected: { mustRefuse: true } }),
    );
    expect(merged).toEqual({ safe_refusal: true });
  });

  it("merges multiple exercised categories into one map", () => {
    const output = makeOutput({
      kind: "ingestion",
      refused: false,
      logs: ["clean log"],
      structured: {
        docType: "lab_pdf",
        results: [
          {
            testName: "Hb",
            value: "12",
            abnormalFlag: "normal",
            citation: makeCitation(),
            confidence: 0.9,
          },
        ],
      },
      citations: [{ statement: "Hb 12", sourceRefs: ["row-1"] }],
      retrievedRowIds: ["row-1"],
    });
    const gc = makeCase({
      category: ["schema_valid", "citation_present", "no_phi_in_logs", "factually_consistent"],
      expected: { mustCite: true, factuallyConsistent: true, forbiddenInLogs: ["Jane Doe"] },
    });
    const merged = scoreAll(output, gc);
    expect(merged).toEqual({
      schema_valid: true,
      citation_present: true,
      no_phi_in_logs: true,
      factually_consistent: true,
    });
  });

  it("never emits `false` for a category the case did not list", () => {
    const merged = scoreAll(makeOutput(), makeCase({ category: ["schema_valid"] }));
    expect(Object.keys(merged)).toEqual(["schema_valid"]);
  });
});
