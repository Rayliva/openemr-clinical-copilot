import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { IntakeFormExtraction } from "../src/schemas/intakeForm.js";
import { parseOcrMap } from "../src/ocrMap.js";
import { locateIntakeValues } from "../src/intakeBoxMatch.js";
import type { OcrPage } from "../src/boxMatch.js";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/w2");
const load = (name: string): unknown => JSON.parse(readFileSync(resolve(dir, name), "utf8"));

const extraction = IntakeFormExtraction.parse(load("susan-intake-form.extraction.json"));
const ocrPage: OcrPage = parseOcrMap(load("susan-intake-form.page-1.ocr.json"));

describe("locateIntakeValues — flatten intake extraction into located lab-shaped values", () => {
  it("flattens demographics, medications, allergies, and family history into one results list", () => {
    const { results } = locateIntakeValues(extraction, ocrPage);
    // 5 demographics + 3 meds + 1 allergy + 2 family history = 11
    expect(results).toHaveLength(11);

    const testNames = results.map((r) => r.result.testName);
    expect(testNames).toContain("Name");
    expect(testNames).toContain("DOB");
    // Repeated field types are NUMBERED so each is unique (prevents write-path key collisions).
    expect(testNames.filter((t) => t.startsWith("Medication"))).toEqual(["Medication 1", "Medication 2", "Medication 3"]);
    expect(testNames.filter((t) => t.startsWith("Allergy"))).toEqual(["Allergy 1"]);
    expect(testNames.filter((t) => t.startsWith("Family history"))).toEqual(["Family history 1", "Family history 2"]);
    // No two flattened values share a testName → the (document, code) supersede key never collides.
    expect(new Set(testNames).size).toBe(testNames.length);
  });

  it("composes flattened values from the structured fields", () => {
    const { results } = locateIntakeValues(extraction, ocrPage);
    const name = results.find((r) => r.result.testName === "Name");
    expect(name?.result.value).toBe("Susan Underwood");
    const met = results.find((r) => r.result.value.startsWith("Metformin"));
    expect(met?.result.value).toBe("Metformin 1000 mg twice daily");
    const allergy = results.find((r) => r.result.value === "Penicillin — rash");
    expect(allergy?.result.value).toBe("Penicillin — rash");
    const fh = results.find((r) => r.result.value.includes("Type 2 diabetes"));
    expect(fh?.result.value).toContain("Type 2 diabetes");
  });

  it("box-matches each value against the OCR page — a value present on the page gets a located box", () => {
    const { results } = locateIntakeValues(extraction, ocrPage);
    const met = results.find((r) => r.result.value.startsWith("Metformin"));
    expect(met?.match.state).toBe("located");
    expect(met?.result.citation.locator).toBeDefined();

    const name = results.find((r) => r.result.testName === "Name");
    expect(name?.match.state).toBe("located");
    expect(name?.result.citation.locator).toMatchObject({ page: 1 });
  });

  it("composite allergy/family-history values box-match on the page (em-dash is display-only, not matched)", () => {
    // Regression: the em-dash separator we synthesize for display ("Penicillin — rash") is NOT on the
    // scanned page, so matching against it previously forced every allergy + family-history value to
    // review. The components ("Penicillin", "rash"; "father", "Type 2 diabetes") ARE on the page, so the
    // value must now resolve (located or approximate), never unverified.
    const { results } = locateIntakeValues(extraction, ocrPage);
    const allergy = results.find((r) => r.result.value === "Penicillin — rash");
    expect(allergy?.result.value).toBe("Penicillin — rash"); // display keeps the em-dash
    expect(allergy?.match.state).not.toBe("unverified");
    const fh = results.find((r) => r.result.value.includes("Type 2 diabetes"));
    expect(fh?.match.state).not.toBe("unverified");
  });

  it("every flattened result carries a citation and a demographics field gets a synthesized one", () => {
    const { results } = locateIntakeValues(extraction, ocrPage);
    for (const r of results) {
      expect(r.result.citation.sourceType).toBe("intake_form");
      expect(r.result.citation.pageOrSection.length).toBeGreaterThan(0);
      expect(r.result.abnormalFlag).toBe("unknown");
      expect(r.result.unit).toBeUndefined();
    }
    const dob = results.find((r) => r.result.testName === "DOB");
    expect(dob?.result.citation.pageOrSection).toBe("Demographics");
    expect(dob?.result.citation.sourceId).toBe("fixture-susan-intake-form");
  });

  it("a value not on the page → unverified, locator absent, citation preserved (never dropped)", () => {
    const empty: OcrPage = { words: [] };
    const { results } = locateIntakeValues(extraction, empty);
    expect(results).toHaveLength(11);
    for (const r of results) {
      expect(r.match.state).toBe("unverified");
      expect(r.result.citation.locator).toBeUndefined();
      expect(r.result.citation.pageOrSection.length).toBeGreaterThan(0);
    }
  });

  it("omits absent demographics fields rather than emitting empty rows", () => {
    const sparse = IntakeFormExtraction.parse({
      docType: "intake_form",
      demographics: { name: "Jane Doe" },
      currentMedications: [],
      allergies: [],
      familyHistory: [],
      citation: {
        sourceType: "intake_form",
        sourceId: "s1",
        pageOrSection: "Intake Form",
        fieldOrChunkId: "document",
        quoteOrValue: "Intake",
      },
    });
    const { results } = locateIntakeValues(sparse, { words: [] });
    expect(results).toHaveLength(1);
    expect(results[0]?.result.testName).toBe("Name");
  });
});
