import { describe, it, expect } from "vitest";
import { repairClaimsText } from "../src/graph/claudeGenerate.js";

describe("repairClaimsText — salvage Claude's double-encoded structured output", () => {
  it("unwraps { claims: '<stringified {claims:[...]}>' }", () => {
    const inner = { claims: [{ statement: "HbA1c target is below 7%.", sourceRefs: ["g::0::0"] }] };
    const doubleEncoded = JSON.stringify({ claims: JSON.stringify(inner) });
    const fixed = repairClaimsText(doubleEncoded);
    expect(fixed).not.toBeNull();
    if (fixed === null) throw new Error("unreachable");
    expect(JSON.parse(fixed)).toEqual(inner);
  });

  it("unwraps { claims: '<stringified [...] array>' }", () => {
    const arr = [{ statement: "x", sourceRefs: [] }];
    const doubleEncoded = JSON.stringify({ claims: JSON.stringify(arr) });
    const fixed = repairClaimsText(doubleEncoded);
    if (fixed === null) throw new Error("expected repair");
    expect(JSON.parse(fixed)).toEqual({ claims: arr });
  });

  it("returns null for already-valid output (no repair applies — only called on failure)", () => {
    expect(repairClaimsText(JSON.stringify({ claims: [{ statement: "z", sourceRefs: [] }] }))).toBeNull();
  });

  it("returns null for genuinely unrepairable text (not JSON, wrong shape)", () => {
    expect(repairClaimsText("Here is my answer, not JSON.")).toBeNull();
    expect(repairClaimsText(JSON.stringify({ other: 1 }))).toBeNull();
    expect(repairClaimsText(JSON.stringify({ claims: "not even json" }))).toBeNull();
  });
});
