import { describe, it, expect } from "vitest";
import { checkCitations } from "../src/citations.js";

const RETRIEVED = ["uuid-a", "uuid-b"];

describe("checkCitations", () => {
  it("verifies a claim whose refs all resolve to retrieved provenance", () => {
    const v = checkCitations([{ statement: "DOB is 1967-02-08", sourceRefs: ["uuid-a"] }], RETRIEVED);
    expect(v.ok).toBe(true);
    expect(v.verifiedClaims).toHaveLength(1);
    expect(v.rejectedClaims).toHaveLength(0);
  });

  it("rejects a claim citing a source that was not retrieved (hallucinated citation)", () => {
    const v = checkCitations([{ statement: "on metformin", sourceRefs: ["uuid-zzz"] }], RETRIEVED);
    expect(v.ok).toBe(false);
    expect(v.verifiedClaims).toHaveLength(0);
    expect(v.rejectedClaims).toHaveLength(1);
  });

  it("rejects an uncited claim (no source refs)", () => {
    const v = checkCitations([{ statement: "looks healthy", sourceRefs: [] }], RETRIEVED);
    expect(v.ok).toBe(false);
    expect(v.rejectedClaims).toHaveLength(1);
  });

  it("rejects a claim if ANY of its refs is unresolved", () => {
    const v = checkCitations([{ statement: "x", sourceRefs: ["uuid-a", "uuid-zzz"] }], RETRIEVED);
    expect(v.ok).toBe(false);
    expect(v.rejectedClaims).toHaveLength(1);
  });

  it("partitions mixed claims into verified vs rejected", () => {
    const v = checkCitations(
      [
        { statement: "good", sourceRefs: ["uuid-a"] },
        { statement: "bad", sourceRefs: ["uuid-zzz"] },
      ],
      RETRIEVED,
    );
    expect(v.ok).toBe(false);
    expect(v.verifiedClaims.map((c) => c.statement)).toEqual(["good"]);
    expect(v.rejectedClaims.map((c) => c.statement)).toEqual(["bad"]);
  });
});
