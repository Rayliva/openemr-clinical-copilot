import { describe, it, expect } from "vitest";
import { checkConstraints, type ConstraintFacts } from "../src/constraints.js";

const noAllergies = { documented: false } as const;

function med(
  drug: string,
  status: "active" | "inactive" | "conflicted",
  sourceRefs: string[],
) {
  return { drug, status, hasConflict: status === "conflicted", sourceRefs };
}

describe("checkConstraints", () => {
  it("flags a conflicted medication, citing both source rows", () => {
    const facts: ConstraintFacts = {
      medications: [med("Lisinopril", "conflicted", ["rx-1", "list-1"])],
      allergies: { documented: true, substances: [] },
    };
    const findings = checkConstraints(facts);
    const conflict = findings.filter((f) => f.code === "medication-status-conflict");
    expect(conflict).toHaveLength(1);
    expect(conflict[0]!.severity).toBe("warning");
    expect([...conflict[0]!.sourceRefs].sort()).toEqual(["list-1", "rx-1"]);
  });

  it("flags duplicate therapy for two active drugs in the same class", () => {
    const facts: ConstraintFacts = {
      medications: [med("Lipitor", "active", ["a"]), med("Simvastatin", "active", ["b"])],
      allergies: { documented: true, substances: [] },
    };
    const dup = checkConstraints(facts).filter((f) => f.code === "duplicate-therapy");
    expect(dup).toHaveLength(1);
    expect([...dup[0]!.sourceRefs].sort()).toEqual(["a", "b"]);
    // Grammar: two drugs read "X and Y are the same class (statin)", not "are all statin".
    expect(dup[0]!.message).toContain("Lipitor and Simvastatin are the same class (statin)");
    expect(dup[0]!.message).not.toContain("are all");
  });

  it("does NOT flag duplicate therapy for drugs in different classes", () => {
    const facts: ConstraintFacts = {
      medications: [med("Lisinopril", "active", ["a"]), med("Metformin", "active", ["b"])],
      allergies: { documented: true, substances: [] },
    };
    expect(checkConstraints(facts).filter((f) => f.code === "duplicate-therapy")).toHaveLength(0);
  });

  it("does NOT flag duplicate therapy when one of the pair is inactive", () => {
    const facts: ConstraintFacts = {
      medications: [med("Lipitor", "active", ["a"]), med("Simvastatin", "inactive", ["b"])],
      allergies: { documented: true, substances: [] },
    };
    expect(checkConstraints(facts).filter((f) => f.code === "duplicate-therapy")).toHaveLength(0);
  });

  it("emits allergy-status-unknown (info, no refs) when allergies are undocumented", () => {
    const facts: ConstraintFacts = { medications: [], allergies: noAllergies };
    const unknown = checkConstraints(facts).filter((f) => f.code === "allergy-status-unknown");
    expect(unknown).toHaveLength(1);
    expect(unknown[0]!.severity).toBe("info");
    expect(unknown[0]!.sourceRefs).toEqual([]);
  });

  it("flags an allergy contraindication by shared class, citing med and allergy rows", () => {
    const facts: ConstraintFacts = {
      medications: [med("Amoxicillin", "active", ["med-1"])],
      allergies: { documented: true, substances: [{ name: "Penicillin", ref: "alg-1" }] },
    };
    const contra = checkConstraints(facts).filter((f) => f.code === "allergy-contraindication");
    expect(contra).toHaveLength(1);
    expect(contra[0]!.severity).toBe("warning");
    expect([...contra[0]!.sourceRefs].sort()).toEqual(["alg-1", "med-1"]);
  });

  it("flags a contraindication for a QUALIFIED allergy spelling (VK / plural) vs a same-class med", () => {
    // Real OpenEMR allergy free-text is rarely a bare class key. Regression for the
    // exact-string-only matcher bug: "Penicillin VK" / "Penicillins" must still resolve
    // to the penicillin class and flag active amoxicillin.
    for (const name of ["Penicillin VK", "Penicillins", "Penicillin V Potassium"]) {
      const facts: ConstraintFacts = {
        medications: [med("Amoxicillin 500 MG Oral Capsule", "active", ["med-1"])],
        allergies: { documented: true, substances: [{ name, ref: "alg-1" }] },
      };
      const contra = checkConstraints(facts).filter((f) => f.code === "allergy-contraindication");
      expect(contra, `should flag for allergy spelled "${name}"`).toHaveLength(1);
    }
  });

  it("flags a contraindication by exact name for a drug NOT in the class map", () => {
    // The matchesByName branch is the only guard for un-classed drugs. Allergic to a
    // drug with no DRUG_CLASS entry while actively on the same drug.
    const facts: ConstraintFacts = {
      medications: [med("Hydrochlorothiazide", "active", ["med-1"])],
      allergies: { documented: true, substances: [{ name: "hydrochlorothiazide", ref: "alg-1" }] },
    };
    const contra = checkConstraints(facts).filter((f) => f.code === "allergy-contraindication");
    expect(contra).toHaveLength(1);
    expect([...contra[0]!.sourceRefs].sort()).toEqual(["alg-1", "med-1"]);
  });

  it("emits a distinct unavailable guard when the allergy read FAILED (not confirmed-absent)", () => {
    // A failed read must NOT be treated as safer than a confirmed-absent chart.
    const facts: ConstraintFacts = {
      medications: [],
      allergies: { documented: false, reason: "unavailable" },
    };
    const guard = checkConstraints(facts).filter((f) => f.code === "allergy-status-unknown");
    expect(guard).toHaveLength(1);
    expect(guard[0]!.message.toLowerCase()).toContain("could not");
  });

  it("does NOT flag a contraindication when no med matches the allergy", () => {
    const facts: ConstraintFacts = {
      medications: [med("Metformin", "active", ["med-1"])],
      allergies: { documented: true, substances: [{ name: "Penicillin", ref: "alg-1" }] },
    };
    expect(checkConstraints(facts).filter((f) => f.code === "allergy-contraindication")).toHaveLength(0);
  });

  it("reproduces Susan's real facts: one conflict + one allergy-unknown, nothing else", () => {
    const facts: ConstraintFacts = {
      medications: [
        med("Lipitor", "active", ["list-lipitor"]),
        med("Lisinopril", "conflicted", ["rx-lis", "list-lis"]),
        med("Metformin", "active", ["list-met"]),
      ],
      allergies: noAllergies,
    };
    const codes = checkConstraints(facts).map((f) => f.code).sort();
    expect(codes).toEqual(["allergy-status-unknown", "medication-status-conflict"]);
  });

  it("orders findings deterministically regardless of input order", () => {
    const meds = [
      med("Lipitor", "active", ["a"]),
      med("Simvastatin", "active", ["b"]),
      med("Lisinopril", "conflicted", ["c", "d"]),
    ];
    const facts: ConstraintFacts = { medications: meds, allergies: noAllergies };
    const forward = checkConstraints(facts).map((f) => f.code);
    const reversed = checkConstraints({ ...facts, medications: [...meds].reverse() }).map((f) => f.code);
    expect(reversed).toEqual(forward);
    // warnings (conflict, duplicate) sort before info (allergy-status-unknown)
    expect(forward[forward.length - 1]).toBe("allergy-status-unknown");
  });
});
