import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/** The paired fixtures whose HTML is rendered to a source PDF + a page-raster PNG. */
const fixtures = ["susan-lab-panel", "susan-intake-form"] as const;

function assetPath(name: string): URL {
  return new URL(`../fixtures/w2/${name}`, import.meta.url);
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe("W2 rendered fixture assets (the VLM/OCR page raster + the source document)", () => {
  for (const name of fixtures) {
    it(`${name}: committed PNG page raster is a valid, non-trivial PNG`, () => {
      const buf = readFileSync(assetPath(`${name}.page-1.png`));
      expect([...buf.subarray(0, 8)]).toEqual(PNG_MAGIC);
      // a blank/empty render would be a few hundred bytes; a real page is many KB
      expect(buf.length).toBeGreaterThan(2000);
    });

    it(`${name}: committed source PDF has a valid PDF header`, () => {
      const buf = readFileSync(assetPath(`${name}.pdf`));
      expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
      expect(buf.length).toBeGreaterThan(1000);
    });
  }
});
