import { describe, it, expect } from "vitest";
import { IntakeFormExtraction } from "../src/schemas/intakeForm.js";

const citation = {
  sourceType: "intake_form",
  sourceId: "form-1",
  pageOrSection: "Medications",
  fieldOrChunkId: "med-0",
  quoteOrValue: "Lisinopril 10 mg",
};

function validIntake(over: Record<string, unknown> = {}) {
  return {
    docType: "intake_form",
    demographics: { name: "Jane Doe", dob: "1970-01-01" },
    chiefConcern: "headache",
    currentMedications: [{ name: "Lisinopril", dose: "10 mg", citation, confidence: 0.8 }],
    allergies: [{ substance: "Penicillin", reaction: "rash", citation, confidence: 0.7 }],
    familyHistory: [{ condition: "Diabetes", relation: "mother", citation, confidence: 0.6 }],
    citation,
    ...over,
  };
}

describe("IntakeFormExtraction", () => {
  it("parses a well-formed intake extraction", () => {
    const res = IntakeFormExtraction.parse(validIntake());
    expect(res.docType).toBe("intake_form");
    expect(res.currentMedications[0]!.name).toBe("Lisinopril");
    expect(res.allergies[0]!.substance).toBe("Penicillin");
  });

  it("allows empty lists (absence-aware)", () => {
    const res = IntakeFormExtraction.parse(
      validIntake({ currentMedications: [], allergies: [], familyHistory: [] }),
    );
    expect(res.currentMedications).toEqual([]);
  });

  it("allows omitted demographic fields (all optional)", () => {
    const res = IntakeFormExtraction.parse(validIntake({ demographics: {} }));
    expect(res.demographics.name).toBeUndefined();
  });

  it("degrades an omitted demographics block to {} (absence-aware, no whole-doc reject)", () => {
    const doc = validIntake();
    delete (doc as Record<string, unknown>).demographics;
    const res = IntakeFormExtraction.parse(doc);
    expect(res.demographics).toEqual({});
  });

  it("rejects a medication item missing its citation", () => {
    const bad = validIntake({ currentMedications: [{ name: "Aspirin", confidence: 0.5 }] });
    expect(IntakeFormExtraction.safeParse(bad).success).toBe(false);
  });

  it("rejects an allergy item missing its confidence", () => {
    const bad = validIntake({ allergies: [{ substance: "Sulfa", citation }] });
    expect(IntakeFormExtraction.safeParse(bad).success).toBe(false);
  });

  it("rejects a family-history item with confidence out of range", () => {
    const bad = validIntake({ familyHistory: [{ condition: "CAD", citation, confidence: 2 }] });
    expect(IntakeFormExtraction.safeParse(bad).success).toBe(false);
  });

  it("requires a document-level citation", () => {
    const bad = validIntake();
    delete (bad as Record<string, unknown>).citation;
    expect(IntakeFormExtraction.safeParse(bad).success).toBe(false);
  });
});
