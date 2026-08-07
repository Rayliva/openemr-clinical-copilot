import { describe, it, expect } from "vitest";
import { toConstraintFacts } from "../src/graph/constraintFacts.js";
import type { AssembledFacts } from "../src/graph/types.js";

const P = (rowUuid: string) => ({ sourceTable: "lists", rowUuid, fetchedAt: "2026-07-08T12:00:00.000Z" });

const base: AssembledFacts = {
  demographics: null,
  problems: null,
  medications: null,
  allergies: null,
  immunizations: null,
  unavailableSources: [],
};

describe("toConstraintFacts", () => {
  it("maps reconciled meds to constraint meds with row refs", () => {
    const facts: AssembledFacts = {
      ...base,
      medications: {
        documented: true,
        medications: [
          {
            drug: "Lisinopril",
            status: "conflicted",
            hasConflict: true,
            sources: [],
            provenance: [P("rx-lis"), P("list-lis")],
          },
        ],
      },
    };
    const out = toConstraintFacts(facts);
    expect(out.medications).toEqual([
      { drug: "Lisinopril", status: "conflicted", hasConflict: true, sourceRefs: ["rx-lis", "list-lis"] },
    ]);
  });

  it("maps a documented-empty allergy record to documented:false (fires the absence guard)", () => {
    const out = toConstraintFacts({ ...base, allergies: { documented: false } });
    expect(out.allergies).toEqual({ documented: false, reason: "absent" });
  });

  it("treats un-fetched allergies as assessed-empty (no false 'none documented')", () => {
    const out = toConstraintFacts({ ...base, allergies: null });
    expect(out.allergies).toEqual({ documented: true, substances: [] });
  });

  it("treats a FAILED allergy read as unavailable, NOT as assessed-empty (safety)", () => {
    // The read was attempted and failed (null + listed in unavailableSources). This must
    // NOT collapse to documented-empty, which would suppress the safety guard — it must
    // fire the unavailable guard so a failed read is never treated as no-known-allergies.
    const out = toConstraintFacts({ ...base, allergies: null, unavailableSources: ["allergies"] });
    expect(out.allergies).toEqual({ documented: false, reason: "unavailable" });
  });

  it("maps documented allergies to substances with refs", () => {
    const out = toConstraintFacts({
      ...base,
      allergies: {
        documented: true,
        allergies: [{ substance: "Penicillin", provenance: P("alg-1") }],
      },
    });
    expect(out.allergies).toEqual({ documented: true, substances: [{ name: "Penicillin", ref: "alg-1" }] });
  });
});
