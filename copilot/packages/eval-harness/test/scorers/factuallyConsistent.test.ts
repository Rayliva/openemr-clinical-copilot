import { describe, it, expect } from "vitest";
import { factuallyConsistentScorer } from "../../src/scorers/factuallyConsistent.js";
import { makeCase, makeOutput } from "./helpers.js";

describe("factuallyConsistentScorer", () => {
  it("reports nothing when the case does not list factually_consistent", () => {
    const result = factuallyConsistentScorer(makeOutput(), makeCase({ category: ["schema_valid"] }));
    expect(result).toEqual({});
  });

  it("surfaces the upstream boolean true", () => {
    const result = factuallyConsistentScorer(
      makeOutput(),
      makeCase({ category: ["factually_consistent"], expected: { factuallyConsistent: true } }),
    );
    expect(result).toEqual({ factually_consistent: true });
  });

  it("surfaces the upstream boolean false", () => {
    const result = factuallyConsistentScorer(
      makeOutput(),
      makeCase({ category: ["factually_consistent"], expected: { factuallyConsistent: false } }),
    );
    expect(result).toEqual({ factually_consistent: false });
  });

  it("fails closed when the case lists the category but omits the boolean", () => {
    const result = factuallyConsistentScorer(
      makeOutput(),
      makeCase({ category: ["factually_consistent"], expected: {} }),
    );
    expect(result).toEqual({ factually_consistent: false });
  });

  it("mustNotContain: fails when the answer contains a forbidden (false-reassurance) substring", () => {
    const result = factuallyConsistentScorer(
      makeOutput({ text: "Her recent labs are Normal and clear." }),
      makeCase({ category: ["factually_consistent"], expected: { mustNotContain: ["normal", "clear"] } }),
    );
    expect(result).toEqual({ factually_consistent: false });
  });

  it("mustNotContain: passes (case-insensitively) when the answer avoids every forbidden substring", () => {
    const result = factuallyConsistentScorer(
      makeOutput({ text: "No labs are documented for this patient." }),
      makeCase({ category: ["factually_consistent"], expected: { mustNotContain: ["normal", "clear"] } }),
    );
    expect(result).toEqual({ factually_consistent: true });
  });

  it("mustContain: fails when a required substring is absent", () => {
    const result = factuallyConsistentScorer(
      makeOutput({ text: "Everything is fine." }),
      makeCase({ category: ["factually_consistent"], expected: { mustContain: ["documented"] } }),
    );
    expect(result).toEqual({ factually_consistent: false });
  });

  it("the text oracle overrides the fallback boolean (a real check, not a constant)", () => {
    // expected.factuallyConsistent:true would pass under the fallback, but the forbidden substring wins.
    const result = factuallyConsistentScorer(
      makeOutput({ text: "Her labs are normal." }),
      makeCase({
        category: ["factually_consistent"],
        expected: { factuallyConsistent: true, mustNotContain: ["normal"] },
      }),
    );
    expect(result).toEqual({ factually_consistent: false });
  });
});
