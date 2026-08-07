import { describe, it, expect } from "vitest";
import { schemaValidScorer } from "../../src/scorers/schemaValid.js";
import { makeCase, makeOutput, makeCitation } from "./helpers.js";

const validLabDraft = {
  docType: "lab_pdf",
  results: [
    {
      testName: "Hemoglobin",
      value: "12.3",
      abnormalFlag: "normal",
      citation: makeCitation(),
      confidence: 0.9,
    },
  ],
};

const validIntakeDraft = {
  docType: "intake_form",
  demographics: {},
  currentMedications: [],
  allergies: [],
  familyHistory: [],
  citation: makeCitation({ sourceType: "intake_form" }),
};

const validChatStructured = {
  text: "Patient is on lisinopril.",
  citations: [{ statement: "on lisinopril", sourceRefs: ["row-1"] }],
};

describe("schemaValidScorer", () => {
  it("reports nothing when the case does not list schema_valid", () => {
    const result = schemaValidScorer(
      makeOutput({ structured: { garbage: true } }),
      makeCase({ category: ["safe_refusal"] }),
    );
    expect(result).toEqual({});
  });

  it("passes a valid lab_pdf ingestion draft", () => {
    const result = schemaValidScorer(
      makeOutput({ kind: "ingestion", structured: validLabDraft }),
      makeCase({ category: ["schema_valid"] }),
    );
    expect(result).toEqual({ schema_valid: true });
  });

  it("passes a valid intake_form ingestion draft", () => {
    const result = schemaValidScorer(
      makeOutput({ kind: "ingestion", structured: validIntakeDraft }),
      makeCase({ category: ["schema_valid"] }),
    );
    expect(result).toEqual({ schema_valid: true });
  });

  it("fails an ingestion draft with an unknown docType", () => {
    const result = schemaValidScorer(
      makeOutput({ kind: "ingestion", structured: { docType: "mystery", results: [] } }),
      makeCase({ category: ["schema_valid"] }),
    );
    expect(result).toEqual({ schema_valid: false });
  });

  it("fails an ingestion draft missing a required field (regression catcher)", () => {
    const broken = {
      docType: "lab_pdf",
      results: [{ testName: "Hemoglobin", abnormalFlag: "normal", confidence: 0.9 }],
    };
    const result = schemaValidScorer(
      makeOutput({ kind: "ingestion", structured: broken }),
      makeCase({ category: ["schema_valid"] }),
    );
    expect(result).toEqual({ schema_valid: false });
  });

  it("passes a well-formed chat structured response", () => {
    const result = schemaValidScorer(
      makeOutput({ kind: "chat", structured: validChatStructured }),
      makeCase({ category: ["schema_valid"] }),
    );
    expect(result).toEqual({ schema_valid: true });
  });

  it("fails a malformed chat structured response", () => {
    const result = schemaValidScorer(
      makeOutput({ kind: "chat", structured: { text: 5, citations: "nope" } }),
      makeCase({ category: ["schema_valid"] }),
    );
    expect(result).toEqual({ schema_valid: false });
  });

  it("is deterministic — same input yields the same output", () => {
    const output = makeOutput({ kind: "ingestion", structured: validLabDraft });
    const gc = makeCase({ category: ["schema_valid"] });
    expect(schemaValidScorer(output, gc)).toEqual(schemaValidScorer(output, gc));
  });
});
