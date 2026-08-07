/**
 * Embedded, deterministic stand-in data for the offline stub engine (T3). All content lives in
 * this module — the stub does NO filesystem/network IO, so CI runs offline with no live key
 * (`.claude/rules/w2-eval-gate.md`). The happy-path shapes mimic the committed goldens under
 * `packages/ingestion/fixtures/w2/` (`susan-*.extraction.json`, `susan-*.page-1.ocr.json`) closely
 * enough to parse against the canonical Zod schemas and to let the box-match locate values.
 */
import type { LabPdfExtraction, IntakeFormExtraction, OcrPage } from "@copilot/ingestion";

/** Which stub document a fixture id resolves to. Routing is by substring so any reasonable alias
 * a golden case chooses (`susan-lab-panel`, `fixture-susan-lab-panel`, `lab`) resolves. */
export type StubDocType = "lab_pdf" | "intake_form";

/**
 * Resolve a (possibly aliased) fixture id to its document type. Throws — fail loud, never a silent
 * empty extraction — on an id that matches neither known document (`w2-document-ingestion-writes`).
 */
export function resolveDocType(fixtureId: string): StubDocType {
  const id = fixtureId.toLowerCase();
  if (id.includes("lab")) {
    return "lab_pdf";
  }
  if (id.includes("intake")) {
    return "intake_form";
  }
  throw new Error(
    `stub engine: unknown document fixture id "${fixtureId}" (expected one containing "lab" or "intake")`,
  );
}

/** The happy-path lab extraction — mirrors `susan-lab-panel.extraction.json`. */
export const LAB_EXTRACTION: LabPdfExtraction = {
  docType: "lab_pdf",
  results: [
    {
      testName: "Hemoglobin A1c",
      value: "8.1",
      unit: "%",
      referenceRange: "<5.7",
      collectionDate: "2026-07-05",
      abnormalFlag: "high",
      confidence: 0.98,
      citation: {
        sourceType: "lab_pdf",
        sourceId: "fixture-susan-lab-panel",
        pageOrSection: "Diabetes",
        fieldOrChunkId: "a1c",
        quoteOrValue: "Hemoglobin A1c 8.1 % (H)",
      },
    },
    {
      testName: "Glucose, Fasting",
      value: "165",
      unit: "mg/dL",
      referenceRange: "70-99",
      collectionDate: "2026-07-05",
      abnormalFlag: "high",
      confidence: 0.97,
      citation: {
        sourceType: "lab_pdf",
        sourceId: "fixture-susan-lab-panel",
        pageOrSection: "Diabetes",
        fieldOrChunkId: "fasting_glucose",
        quoteOrValue: "Glucose, Fasting 165 mg/dL (H)",
      },
    },
    {
      testName: "LDL Cholesterol",
      value: "138",
      unit: "mg/dL",
      referenceRange: "<100",
      collectionDate: "2026-07-05",
      abnormalFlag: "high",
      confidence: 0.95,
      citation: {
        sourceType: "lab_pdf",
        sourceId: "fixture-susan-lab-panel",
        pageOrSection: "Lipid Panel",
        fieldOrChunkId: "ldl",
        quoteOrValue: "LDL Cholesterol 138 mg/dL (H)",
      },
    },
    {
      testName: "HDL Cholesterol",
      value: "38",
      unit: "mg/dL",
      referenceRange: ">40",
      collectionDate: "2026-07-05",
      abnormalFlag: "low",
      confidence: 0.95,
      citation: {
        sourceType: "lab_pdf",
        sourceId: "fixture-susan-lab-panel",
        pageOrSection: "Lipid Panel",
        fieldOrChunkId: "hdl",
        quoteOrValue: "HDL Cholesterol 38 mg/dL (L)",
      },
    },
    {
      testName: "Triglycerides",
      value: "210",
      unit: "mg/dL",
      referenceRange: "<150",
      collectionDate: "2026-07-05",
      abnormalFlag: "high",
      confidence: 0.94,
      citation: {
        sourceType: "lab_pdf",
        sourceId: "fixture-susan-lab-panel",
        pageOrSection: "Lipid Panel",
        fieldOrChunkId: "triglycerides",
        quoteOrValue: "Triglycerides 210 mg/dL (H)",
      },
    },
    {
      testName: "eGFR",
      value: "45",
      unit: "mL/min/1.73m2",
      referenceRange: ">=60",
      collectionDate: "2026-07-05",
      abnormalFlag: "low",
      confidence: 0.93,
      citation: {
        sourceType: "lab_pdf",
        sourceId: "fixture-susan-lab-panel",
        pageOrSection: "Renal Function",
        fieldOrChunkId: "egfr",
        quoteOrValue: "eGFR 45 mL/min/1.73m2 (L)",
      },
    },
    {
      testName: "Creatinine",
      value: "1.3",
      unit: "mg/dL",
      referenceRange: "0.6-1.1",
      collectionDate: "2026-07-05",
      abnormalFlag: "high",
      confidence: 0.96,
      citation: {
        sourceType: "lab_pdf",
        sourceId: "fixture-susan-lab-panel",
        pageOrSection: "Renal Function",
        fieldOrChunkId: "creatinine",
        quoteOrValue: "Creatinine 1.3 mg/dL (H)",
      },
    },
    {
      testName: "Sodium",
      value: "140",
      unit: "mmol/L",
      referenceRange: "135-145",
      collectionDate: "2026-07-05",
      abnormalFlag: "normal",
      confidence: 0.97,
      citation: {
        sourceType: "lab_pdf",
        sourceId: "fixture-susan-lab-panel",
        pageOrSection: "Chemistry",
        fieldOrChunkId: "sodium",
        quoteOrValue: "Sodium 140 mmol/L",
      },
    },
  ],
};

/** The happy-path intake extraction — mirrors `susan-intake-form.extraction.json`. */
export const INTAKE_EXTRACTION: IntakeFormExtraction = {
  docType: "intake_form",
  demographics: {
    name: "Susan Underwood",
    dob: "03/14/1958",
    sex: "Female",
    phone: "(512) 555-0148",
    address: "482 Elm St, Austin, TX 78701",
  },
  chiefConcern:
    "Follow-up for type 2 diabetes; reports increased fatigue and occasional blurred vision over the past month.",
  currentMedications: [
    {
      name: "Metformin",
      dose: "1000 mg twice daily",
      confidence: 0.96,
      citation: {
        sourceType: "intake_form",
        sourceId: "fixture-susan-intake-form",
        pageOrSection: "Current Medications",
        fieldOrChunkId: "med-0",
        quoteOrValue: "Metformin 1000 mg twice daily",
      },
    },
    {
      name: "Lisinopril",
      dose: "20 mg daily",
      confidence: 0.95,
      citation: {
        sourceType: "intake_form",
        sourceId: "fixture-susan-intake-form",
        pageOrSection: "Current Medications",
        fieldOrChunkId: "med-1",
        quoteOrValue: "Lisinopril 20 mg daily",
      },
    },
    {
      name: "Atorvastatin",
      dose: "40 mg daily",
      confidence: 0.94,
      citation: {
        sourceType: "intake_form",
        sourceId: "fixture-susan-intake-form",
        pageOrSection: "Current Medications",
        fieldOrChunkId: "med-2",
        quoteOrValue: "Atorvastatin 40 mg daily",
      },
    },
  ],
  allergies: [
    {
      substance: "Penicillin",
      reaction: "rash",
      confidence: 0.92,
      citation: {
        sourceType: "intake_form",
        sourceId: "fixture-susan-intake-form",
        pageOrSection: "Allergies",
        fieldOrChunkId: "allergy-0",
        quoteOrValue: "Penicillin — rash",
      },
    },
  ],
  familyHistory: [
    {
      condition: "Type 2 diabetes",
      relation: "father",
      confidence: 0.9,
      citation: {
        sourceType: "intake_form",
        sourceId: "fixture-susan-intake-form",
        pageOrSection: "Family History",
        fieldOrChunkId: "fh-0",
        quoteOrValue: "Father — Type 2 diabetes",
      },
    },
    {
      condition: "Hypertension",
      relation: "mother",
      confidence: 0.9,
      citation: {
        sourceType: "intake_form",
        sourceId: "fixture-susan-intake-form",
        pageOrSection: "Family History",
        fieldOrChunkId: "fh-1",
        quoteOrValue: "Mother — Hypertension",
      },
    },
  ],
  citation: {
    sourceType: "intake_form",
    sourceId: "fixture-susan-intake-form",
    pageOrSection: "Intake Form",
    fieldOrChunkId: "document",
    quoteOrValue: "Patient Intake Form — Susan Underwood",
  },
};

/**
 * A compact but functional lab OCR map — a curated subset of `susan-lab-panel.page-1.ocr.json`
 * that includes every extracted result value as a whole word, so `locateValue` resolves each to a
 * `located` match. Coordinates are the golden's; boxes are [0,1]-normalized, `page` 1-based.
 */
export const LAB_OCR: OcrPage = {
  words: [
    { text: "Patient:", box: { page: 1, x: 0.03983, y: 0.08854, w: 0.06679, h: 0.0071 } },
    { text: "Underwood,", box: { page: 1, x: 0.11887, y: 0.08854, w: 0.08456, h: 0.009 } },
    { text: "Susan", box: { page: 1, x: 0.21691, y: 0.08902, w: 0.04228, h: 0.00663 } },
    { text: "8.1", box: { page: 1, x: 0.38787, y: 0.20549, w: 0.02451, h: 0.00758 } },
    { text: "165", box: { page: 1, x: 0.38787, y: 0.23201, w: 0.02451, h: 0.00758 } },
    { text: "138", box: { page: 1, x: 0.37561, y: 0.31723, w: 0.02451, h: 0.00758 } },
    { text: "38", box: { page: 1, x: 0.37561, y: 0.3428, w: 0.01532, h: 0.00758 } },
    { text: "210", box: { page: 1, x: 0.375, y: 0.36932, w: 0.02512, h: 0.00758 } },
    { text: "45", box: { page: 1, x: 0.26225, y: 0.45455, w: 0.01593, h: 0.00758 } },
    { text: "1.3", box: { page: 1, x: 0.26225, y: 0.48106, w: 0.02512, h: 0.00758 } },
    { text: "140", box: { page: 1, x: 0.23039, y: 0.56534, w: 0.02512, h: 0.00758 } },
  ],
};

/**
 * A compact intake OCR map — includes the medication / allergy value tokens so the box-match can
 * locate them. Coordinates are plausible [0,1]-normalized boxes on page 1.
 */
export const INTAKE_OCR: OcrPage = {
  words: [
    { text: "Susan", box: { page: 1, x: 0.1, y: 0.1, w: 0.06, h: 0.02 } },
    { text: "Underwood", box: { page: 1, x: 0.17, y: 0.1, w: 0.1, h: 0.02 } },
    { text: "Metformin", box: { page: 1, x: 0.1, y: 0.3, w: 0.1, h: 0.02 } },
    { text: "Lisinopril", box: { page: 1, x: 0.1, y: 0.33, w: 0.1, h: 0.02 } },
    { text: "Atorvastatin", box: { page: 1, x: 0.1, y: 0.36, w: 0.12, h: 0.02 } },
    { text: "Penicillin", box: { page: 1, x: 0.1, y: 0.5, w: 0.1, h: 0.02 } },
  ],
};

/** Small pure FNV-1a hash → a stable hex token, so a stubbed row id looks realistic and is a pure
 * function of its input (no randomness). */
export function stableToken(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
