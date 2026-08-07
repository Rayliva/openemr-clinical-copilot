import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { LabPdfExtraction } from "../src/schemas/labPdf.js";
import { IntakeFormExtraction } from "../src/schemas/intakeForm.js";

function loadFixture(name: string): unknown {
  const url = new URL(`../fixtures/w2/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8"));
}

function loadText(name: string): string {
  return readFileSync(new URL(`../fixtures/w2/${name}`, import.meta.url), "utf8");
}

describe("W2 document fixtures (ground-truth extractions)", () => {
  it("susan-lab-panel.extraction.json parses against LabPdfExtraction", () => {
    const parsed = LabPdfExtraction.parse(loadFixture("susan-lab-panel.extraction.json"));
    expect(parsed.docType).toBe("lab_pdf");
    // exercises flag breadth: A1c high + at least one low + one high/critical
    const flags = parsed.results.map((r) => r.abnormalFlag);
    expect(parsed.results.some((r) => /a1c/i.test(r.testName) && r.abnormalFlag === "high")).toBe(true);
    expect(flags).toContain("low");
    expect(flags.some((f) => f === "high" || f === "critical")).toBe(true);
  });

  it("susan-intake-form.extraction.json parses against IntakeFormExtraction", () => {
    const parsed = IntakeFormExtraction.parse(loadFixture("susan-intake-form.extraction.json"));
    expect(parsed.docType).toBe("intake_form");
    expect(parsed.currentMedications.length).toBeGreaterThanOrEqual(2);
    expect(parsed.allergies.some((a) => /penicillin/i.test(a.substance))).toBe(true);
  });
});

describe("W2 fixtures: source HTML matches its ground-truth extraction (drift guard)", () => {
  it("the lab-panel HTML carries every extracted test name + value as its own cell", () => {
    const html = loadText("susan-lab-panel.html");
    const gt = LabPdfExtraction.parse(loadFixture("susan-lab-panel.extraction.json"));
    for (const r of gt.results) {
      // cell-delimited (>x<) so e.g. "38" (HDL) does not spuriously match inside "138" (LDL)
      expect(html, `HTML should carry a <td>${r.testName}</td>`).toContain(`>${r.testName}<`);
      expect(html, `HTML should carry a <td>${r.value}</td> for ${r.testName}`).toContain(`>${r.value}<`);
    }
  });

  it("the intake HTML carries each med/allergy/family-history quote + every demographic value", () => {
    const html = loadText("susan-intake-form.html");
    const gt = IntakeFormExtraction.parse(loadFixture("susan-intake-form.extraction.json"));
    for (const m of gt.currentMedications) expect(html).toContain(m.citation.quoteOrValue);
    for (const a of gt.allergies) expect(html).toContain(a.citation.quoteOrValue);
    for (const f of gt.familyHistory) expect(html).toContain(f.citation.quoteOrValue);
    for (const v of Object.values(gt.demographics)) {
      if (v) expect(html, `HTML should show demographic value "${v}"`).toContain(v);
    }
  });
});
