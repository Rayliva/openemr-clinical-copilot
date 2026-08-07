import { describe, it, expect } from "vitest";
import { MedicationListExtraction } from "../src/schemas/medicationList.js";
import { locateMedicationListValues } from "../src/medicationListBoxMatch.js";
import type { OcrWord, OcrPage } from "../src/boxMatch.js";

/** A citation for a med-list value (sourceType is the third allowed document kind). */
const cite = (q: string) => ({
  sourceType: "medication_list" as const,
  sourceId: "med-1",
  pageOrSection: "Medications",
  fieldOrChunkId: "meds",
  quoteOrValue: q,
});

/** One OCR word with a small box on page 1. */
const w = (text: string, x: number): OcrWord => ({ text, box: { page: 1, x, y: 0.5, w: 0.06, h: 0.02 } });

/** An OCR page carrying the words of two medications. */
const ocr: OcrPage = {
  words: [
    w("Metformin", 0.1), w("1000", 0.2), w("mg", 0.26), w("twice", 0.32), w("daily", 0.4),
    w("Lisinopril", 0.1), w("10", 0.2), w("mg", 0.26), w("once", 0.32), w("daily", 0.4),
  ],
};

const extraction = MedicationListExtraction.parse({
  docType: "medication_list",
  medications: [
    { name: "Metformin", dose: "1000 mg", frequency: "twice daily", status: "active", citation: cite("Metformin 1000 mg twice daily"), confidence: 0.98 },
    { name: "Lisinopril", dose: "10 mg", frequency: "once daily", status: "discontinued", citation: cite("Lisinopril 10 mg once daily"), confidence: 0.95 },
  ],
  citation: cite("Medication List"),
});

describe("MedicationListExtraction schema", () => {
  it("parses a valid medication_list extraction", () => {
    expect(extraction.medications).toHaveLength(2);
    expect(extraction.docType).toBe("medication_list");
  });

  it("rejects a wrong docType (schema is canonical, not coerced)", () => {
    const bad = { ...extraction, docType: "lab_pdf" };
    expect(MedicationListExtraction.safeParse(bad).success).toBe(false);
  });
});

describe("locateMedicationListValues — flatten + box-match", () => {
  it("numbers each medication uniquely (no write-path key collision)", () => {
    const { results } = locateMedicationListValues(extraction, ocr);
    const names = results.map((r) => r.result.testName);
    expect(names).toEqual(["Medication 1", "Medication 2"]);
    expect(new Set(names).size).toBe(names.length);
  });

  it("composes the display value with dose + frequency + printed status", () => {
    const { results } = locateMedicationListValues(extraction, ocr);
    expect(results[0]!.result.value).toBe("Metformin 1000 mg twice daily (active)");
    expect(results[1]!.result.value).toBe("Lisinopril 10 mg once daily (discontinued)");
  });

  it("box-matches on the page words (status word is display-only, not matched)", () => {
    const { results } = locateMedicationListValues(extraction, ocr);
    // "active"/"discontinued" are NOT on the page — matching still resolves off the drug+dose+freq.
    expect(results[0]!.match.state).not.toBe("unverified");
    expect(results[0]!.result.citation.locator).toBeDefined();
  });

  it("forces review (never drops) a medication absent from the page", () => {
    const { results } = locateMedicationListValues(extraction, { words: [] });
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.match.state).toBe("unverified");
      expect(r.result.citation.locator).toBeUndefined();
      expect(r.result.citation.pageOrSection.length).toBeGreaterThan(0);
    }
  });

  it("omits dose/frequency cleanly when absent (name-only medication)", () => {
    const nameOnly = MedicationListExtraction.parse({
      docType: "medication_list",
      medications: [{ name: "Aspirin", citation: cite("Aspirin"), confidence: 0.9 }],
      citation: cite("Medication List"),
    });
    const { results } = locateMedicationListValues(nameOnly, { words: [] });
    expect(results[0]!.result.value).toBe("Aspirin");
  });
});
