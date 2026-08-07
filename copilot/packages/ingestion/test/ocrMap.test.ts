import { describe, it, expect } from "vitest";
import { parseOcrMap } from "../src/ocrMap.js";
import type { OcrPage } from "../src/boxMatch.js";

/** A well-formed committed-map object (the JSON shape `generate-ocr-maps` emits). */
const validMap = {
  words: [
    { text: "A1c", box: { page: 1, x: 0.2, y: 0.3, w: 0.05, h: 0.02 } },
    { text: "8.1", box: { page: 1, x: 0.4, y: 0.3, w: 0.04, h: 0.02 } },
  ],
};

describe("parseOcrMap — committed OCR-map boundary parser", () => {
  it("returns a validated OcrPage for a well-formed map", () => {
    const page: OcrPage = parseOcrMap(validMap);
    expect(page.words).toHaveLength(2);
    expect(page.words[0]).toMatchObject({ text: "A1c", box: { page: 1, x: 0.2 } });
  });

  it("accepts an empty word list (a blank page is valid data, not corruption)", () => {
    expect(parseOcrMap({ words: [] }).words).toHaveLength(0);
  });

  it("throws on a non-object", () => {
    expect(() => parseOcrMap(null)).toThrow();
    expect(() => parseOcrMap("nope")).toThrow();
  });

  it("throws when a coordinate is out of the [0,1] range", () => {
    const bad = { words: [{ text: "x", box: { page: 1, x: 1.4, y: 0.3, w: 0.04, h: 0.02 } }] };
    expect(() => parseOcrMap(bad)).toThrow();
  });

  it("throws when page < 1", () => {
    const bad = { words: [{ text: "x", box: { page: 0, x: 0.2, y: 0.3, w: 0.04, h: 0.02 } }] };
    expect(() => parseOcrMap(bad)).toThrow();
  });

  it("throws when a word is missing its text", () => {
    const bad = { words: [{ box: { page: 1, x: 0.2, y: 0.3, w: 0.04, h: 0.02 } }] };
    expect(() => parseOcrMap(bad)).toThrow();
  });
});
