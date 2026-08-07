import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseOcrMap } from "../src/ocrMap.js";
import { LabPdfExtraction } from "../src/schemas/labPdf.js";
import { locateLabResults } from "../src/boxMatch.js";
import { fromOcrMap } from "../src/ocrPort.js";

/**
 * Offline round-trip: the committed OCR map (a tesseract.js golden) + the committed lab
 * extraction, through the pure matcher — with NO live OCR. Proves the CI-offline half of the
 * OCR decision (`docs/decisions/w2-ocr-engine.md`) end to end.
 */
const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/w2");

function load(name: string): unknown {
  return JSON.parse(readFileSync(resolve(dir, name), "utf8"));
}

const map = parseOcrMap(load("susan-lab-panel.page-1.ocr.json"));
const extraction = LabPdfExtraction.parse(load("susan-lab-panel.extraction.json"));

describe("committed OCR map ↔ lab extraction round-trip (offline)", () => {
  const located = locateLabResults(extraction, map);

  it("locates the A1c value with a single-page [0,1] box (no live OCR)", () => {
    const a1c = located.results.find((r) => r.result.testName === "Hemoglobin A1c");
    expect(a1c).toBeDefined();
    if (a1c === undefined) throw new Error("unreachable");
    expect(a1c.match.state).toBe("located");
    const box = a1c.result.citation.locator;
    expect(box).toBeDefined();
    if (box === undefined) throw new Error("unreachable");
    expect(box.page).toBe(1);
    for (const c of [box.x, box.y, box.w, box.h]) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });

  it("never drops a citation — every result keeps a page/section citation", () => {
    for (const r of located.results) {
      expect(r.result.citation.pageOrSection.length).toBeGreaterThan(0);
      expect(r.result.citation.quoteOrValue).toBeDefined();
    }
    expect(located.results).toHaveLength(extraction.results.length);
  });

  it("locates all eight lab values against the golden map", () => {
    const locatedCount = located.results.filter((r) => r.match.state === "located").length;
    // Golden expectation (verified 2026-07-14): the committed tesseract.js map locates every
    // one of the eight values. Pinned exactly so a golden regeneration that loses any box —
    // or a matcher regression — fails loudly. A value the golden ever split/misreads would
    // degrade to approximate/unverified, never a dropped citation.
    expect(locatedCount).toBe(8);
  });
});

describe("committed golden integrity (both maps)", () => {
  // Guard every committed *.ocr.json — not just the lab map the round-trip exercises — so a
  // corrupt/hand-edited golden (out-of-range coord, empty-text word) fails loud rather than
  // silently becoming an empty page (w2-document-ingestion-writes: never a silent fill).
  for (const name of ["susan-lab-panel.page-1.ocr.json", "susan-intake-form.page-1.ocr.json"]) {
    it(`${name} parses and every box is a single-page [0,1] region`, () => {
      const page = parseOcrMap(load(name));
      expect(page.words.length).toBeGreaterThan(0);
      for (const wd of page.words) {
        expect(wd.text.trim().length).toBeGreaterThan(0);
        expect(wd.box.page).toBe(1);
        for (const c of [wd.box.x, wd.box.y, wd.box.w, wd.box.h]) {
          expect(c).toBeGreaterThanOrEqual(0);
          expect(c).toBeLessThanOrEqual(1);
        }
      }
    });
  }
});

describe("fromOcrMap — committed-map-backed OcrPort (CI/test OCR source)", () => {
  it("returns the fixed map regardless of the request", async () => {
    const port = fromOcrMap(map);
    const out = await port({ pages: [] });
    expect(out).toBe(map);
  });
});
