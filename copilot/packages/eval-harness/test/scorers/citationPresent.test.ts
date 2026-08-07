import { describe, it, expect } from "vitest";
import { citationPresentScorer } from "../../src/scorers/citationPresent.js";
import { makeCase, makeOutput } from "./helpers.js";

describe("citationPresentScorer", () => {
  it("reports nothing when the case does not list citation_present", () => {
    const result = citationPresentScorer(makeOutput(), makeCase({ category: ["schema_valid"] }));
    expect(result).toEqual({});
  });

  it("passes when every claim resolves to a retrieved row id", () => {
    const result = citationPresentScorer(
      makeOutput({
        citations: [{ statement: "on lisinopril", sourceRefs: ["row-1", "row-2"] }],
        retrievedRowIds: ["row-1", "row-2", "row-3"],
      }),
      makeCase({ category: ["citation_present"], expected: { mustCite: true } }),
    );
    expect(result).toEqual({ citation_present: true });
  });

  it("fails when a claim cites a row id that was not retrieved (regression catcher)", () => {
    const result = citationPresentScorer(
      makeOutput({
        citations: [{ statement: "on lisinopril", sourceRefs: ["row-99"] }],
        retrievedRowIds: ["row-1"],
      }),
      makeCase({ category: ["citation_present"], expected: { mustCite: true } }),
    );
    expect(result).toEqual({ citation_present: false });
  });

  it("fails a claim with no source refs at all", () => {
    const result = citationPresentScorer(
      makeOutput({
        citations: [{ statement: "unsupported", sourceRefs: [] }],
        retrievedRowIds: ["row-1"],
      }),
      makeCase({ category: ["citation_present"], expected: { mustCite: true } }),
    );
    expect(result).toEqual({ citation_present: false });
  });

  it("fails a mustCite case that makes no claims at all", () => {
    const result = citationPresentScorer(
      makeOutput({ citations: [], retrievedRowIds: ["row-1"] }),
      makeCase({ category: ["citation_present"], expected: { mustCite: true } }),
    );
    expect(result).toEqual({ citation_present: false });
  });

  it("without mustCite, an empty answer passes (nothing to attribute)", () => {
    const result = citationPresentScorer(
      makeOutput({ citations: [], retrievedRowIds: [] }),
      makeCase({ category: ["citation_present"], expected: {} }),
    );
    expect(result).toEqual({ citation_present: true });
  });

  it("without mustCite, an unresolved claim still fails", () => {
    const result = citationPresentScorer(
      makeOutput({
        citations: [{ statement: "x", sourceRefs: ["ghost"] }],
        retrievedRowIds: ["row-1"],
      }),
      makeCase({ category: ["citation_present"], expected: {} }),
    );
    expect(result).toEqual({ citation_present: false });
  });
});
