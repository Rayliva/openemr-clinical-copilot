import { describe, it, expect } from "vitest";
import { LabPdfExtraction } from "../src/schemas/labPdf.js";

const citation = {
  sourceType: "lab_pdf",
  sourceId: "doc-1",
  pageOrSection: "p1",
  fieldOrChunkId: "a1c",
  quoteOrValue: "7.2",
};

function labResult(over: Record<string, unknown> = {}) {
  return {
    testName: "Hemoglobin A1c",
    value: "7.2",
    unit: "%",
    referenceRange: "<5.7",
    collectionDate: "2026-07-01",
    abnormalFlag: "high",
    citation,
    confidence: 0.9,
    ...over,
  };
}

function labDoc(results: unknown[]) {
  return { docType: "lab_pdf", results };
}

describe("LabPdfExtraction", () => {
  it("parses a well-formed lab extraction", () => {
    const res = LabPdfExtraction.parse(labDoc([labResult()]));
    expect(res.docType).toBe("lab_pdf");
    expect(res.results).toHaveLength(1);
    expect(res.results[0]!.testName).toBe("Hemoglobin A1c");
  });

  it("keeps value as a string (qualitative / comparator values survive)", () => {
    const res = LabPdfExtraction.parse(labDoc([labResult({ value: "<5.7" })]));
    expect(res.results[0]!.value).toBe("<5.7");
    expect(typeof res.results[0]!.value).toBe("string");
  });

  it("rejects a result missing its citation", () => {
    const bad = labResult();
    delete (bad as Record<string, unknown>).citation;
    expect(LabPdfExtraction.safeParse(labDoc([bad])).success).toBe(false);
  });

  it("rejects a result with no confidence", () => {
    const bad = labResult();
    delete (bad as Record<string, unknown>).confidence;
    expect(LabPdfExtraction.safeParse(labDoc([bad])).success).toBe(false);
  });

  it.each([-0.1, 1.1])("rejects confidence out of [0,1]: %s", (c) => {
    expect(LabPdfExtraction.safeParse(labDoc([labResult({ confidence: c })])).success).toBe(false);
  });

  it("rejects an invalid abnormalFlag", () => {
    expect(LabPdfExtraction.safeParse(labDoc([labResult({ abnormalFlag: "kinda-high" })])).success).toBe(false);
  });

  it.each(["normal", "high", "low", "critical", "abnormal", "unknown"])(
    "accepts abnormalFlag %s",
    (flag) => {
      expect(LabPdfExtraction.safeParse(labDoc([labResult({ abnormalFlag: flag })])).success).toBe(true);
    },
  );

  it("is absence-aware: unit/referenceRange/collectionDate may be omitted", () => {
    const minimal = { testName: "Sodium", value: "140", abnormalFlag: "normal", citation, confidence: 0.5 };
    const res = LabPdfExtraction.parse(labDoc([minimal]));
    expect(res.results[0]!.unit).toBeUndefined();
    expect(res.results[0]!.referenceRange).toBeUndefined();
    expect(res.results[0]!.collectionDate).toBeUndefined();
  });

  it("rejects a result with an empty testName", () => {
    expect(LabPdfExtraction.safeParse(labDoc([labResult({ testName: "" })])).success).toBe(false);
  });
});
