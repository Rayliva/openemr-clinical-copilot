import { describe, it, expect } from "vitest";
import { expandQuery } from "../src/expand.js";

/** Tokenize the way retrieval does, for asserting on expanded terms regardless of order/case. */
const terms = (s: string): Set<string> => new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);

describe("expandQuery — clinical abbreviation/synonym expansion", () => {
  it("expands A1c to its canonical guideline terms (case-insensitive)", () => {
    const out = terms(expandQuery("What's her A1c target?"));
    expect(out.has("hemoglobin")).toBe(true);
    expect(out.has("hba1c")).toBe(true);
    expect(out.has("glycemic")).toBe(true);
    // original terms preserved
    expect(out.has("a1c")).toBe(true);
    expect(out.has("target")).toBe(true);
  });

  it("expands common abbreviations (htn, bp, ckd, ldl)", () => {
    expect(terms(expandQuery("htn")).has("hypertension")).toBe(true);
    expect(terms(expandQuery("bp goal")).has("pressure")).toBe(true);
    expect(terms(expandQuery("ckd stage")).has("renal")).toBe(true);
    expect(terms(expandQuery("ldl")).has("cholesterol")).toBe(true);
  });

  it("returns a non-clinical query effectively unchanged (no spurious expansion)", () => {
    const before = terms("when is her next appointment");
    const after = terms(expandQuery("when is her next appointment"));
    expect(after).toEqual(before);
  });

  it("is deterministic (same input → same output)", () => {
    expect(expandQuery("htn and ckd")).toBe(expandQuery("htn and ckd"));
  });

  it("never drops the original query text", () => {
    expect(expandQuery("statin indication").toLowerCase()).toContain("statin indication");
  });
});
