import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { LabPdfExtraction } from "../src/schemas/labPdf.js";
import { locateValue, locateLabResults, type OcrPage, type OcrWord } from "../src/boxMatch.js";

function word(text: string, x: number, y: number, w = 0.05, h = 0.02): OcrWord {
  return { text, box: { page: 1, x, y, w, h } };
}

/** A tiny synthetic OCR page: a couple of lab rows as recognized words with boxes. */
const ocr: OcrPage = {
  words: [
    word("Hemoglobin", 0.1, 0.3),
    word("A1c", 0.2, 0.3),
    word("8.1", 0.4, 0.3),
    word("%", 0.46, 0.3, 0.01),
    word("Blood", 0.1, 0.4),
    word("Pressure", 0.16, 0.4),
    word("150", 0.4, 0.4, 0.03),
    word("/", 0.43, 0.4, 0.008),
    word("80", 0.44, 0.4, 0.02),
    word("Sodium", 0.1, 0.5),
    word("140", 0.4, 0.5, 0.03),
  ],
};

describe("locateValue — three-way box match", () => {
  it("a value present as one OCR word → located, box equals that word", () => {
    const r = locateValue("8.1", ocr);
    expect(r.state).toBe("located");
    if (r.state !== "located") throw new Error("unreachable");
    expect(r.box).toMatchObject({ page: 1, x: 0.4, y: 0.3 });
    expect(r.boxConfidence).toBeGreaterThan(0.9);
  });

  it("a value spanning contiguous words → located, box is the union of those words", () => {
    const r = locateValue("150/80", ocr);
    expect(r.state).toBe("located");
    if (r.state !== "located") throw new Error("unreachable");
    // union of "150"(0.40..0.43) "/"(0.43..0.438) "80"(0.44..0.46)
    expect(r.box.x).toBeCloseTo(0.4, 5);
    expect(r.box.x + r.box.w).toBeCloseTo(0.46, 5);
  });

  it("case / whitespace drift still matches (target '8.1 %' vs words '8.1' '%')", () => {
    const r = locateValue("8.1 %", ocr);
    expect(r.state).toBe("located");
  });

  it("tokens present but not contiguous → approximate, no box", () => {
    // "Hemoglobin ... Sodium" — both words exist on the page but never adjacent
    const r = locateValue("Hemoglobin Sodium", ocr);
    expect(r.state).toBe("approximate");
    expect(r).not.toHaveProperty("box");
  });

  it("a value absent from the page → unverified, boxConfidence 0", () => {
    const r = locateValue("9.9", ocr); // VLM-invented value not on the page
    expect(r.state).toBe("unverified");
    expect(r.boxConfidence).toBe(0);
  });

  it("an empty value cannot be located → unverified (never a silent match)", () => {
    const r = locateValue("   ", ocr);
    expect(r.state).toBe("unverified");
  });

  it("a value that is only a substring of a larger number is UNVERIFIED, not approximate (8.1 vs 138.1)", () => {
    const only138: OcrPage = { words: [word("138.1", 0.4, 0.3)] };
    const r = locateValue("8.1", only138);
    // "8.1" is NOT on the page — it is a digit-substring of a different number "138.1". A value
    // that is not present as a whole word must be forced to review, never softly "approximate".
    expect(r.state).toBe("unverified");
  });

  it("a fabricated short numeric value is UNVERIFIED even when its digits appear inside a real number", () => {
    // Safety: VLM invents "40"; the page shows "140" (a different, real value). "40" must not
    // read as present just because "140" contains it.
    const page: OcrPage = { words: [word("140", 0.4, 0.5, 0.03)] };
    expect(locateValue("40", page).state).toBe("unverified");
  });

  it("does not union a located box across a page boundary", () => {
    const crossPage: OcrPage = {
      words: [
        { text: "15", box: { page: 1, x: 0.4, y: 0.3, w: 0.02, h: 0.02 } },
        { text: "0", box: { page: 2, x: 0.1, y: 0.1, w: 0.01, h: 0.02 } },
      ],
    };
    // "150" would only "match" by joining a word on page 1 with a word on page 2 — forbidden.
    expect(locateValue("150", crossPage).state).toBe("unverified");
  });
});

describe("locateLabResults — enrich a lab extraction", () => {
  const groundTruth = LabPdfExtraction.parse(
    JSON.parse(
      readFileSync(new URL("../fixtures/w2/susan-lab-panel.extraction.json", import.meta.url), "utf8"),
    ),
  );

  it("sets locator on located results and never drops a citation", () => {
    // Build an OCR page that contains every result's value as its own word.
    const words: OcrWord[] = groundTruth.results.map((r, i) => word(r.value, 0.4, 0.1 + i * 0.05));
    const located = locateLabResults(groundTruth, { words });

    expect(located.results).toHaveLength(groundTruth.results.length);
    for (const lr of located.results) {
      expect(lr.match.state).toBe("located");
      expect(lr.result.citation.locator).toBeDefined();
    }
    const a1c = located.results.find((lr) => /a1c/i.test(lr.result.testName));
    expect(a1c?.result.citation.locator).toMatchObject({ page: 1 });
  });

  it("a value not on the page → unverified, locator absent, citation preserved", () => {
    const words: OcrWord[] = [word("nothing", 0.1, 0.1)];
    const located = locateLabResults(groundTruth, { words });
    for (const lr of located.results) {
      expect(lr.match.state).toBe("unverified");
      expect(lr.result.citation.locator).toBeUndefined();
      // citation itself is never dropped — page/section still cited
      expect(lr.result.citation.pageOrSection).toBe(
        groundTruth.results.find((r) => r.testName === lr.result.testName)?.citation.pageOrSection,
      );
    }
  });
});
