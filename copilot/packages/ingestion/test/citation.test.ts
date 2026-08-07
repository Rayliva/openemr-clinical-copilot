import { describe, it, expect } from "vitest";
import { Citation } from "../src/citation.js";

const valid = {
  sourceType: "lab_pdf",
  sourceId: "doc-123",
  pageOrSection: "p2",
  fieldOrChunkId: "hba1c",
  quoteOrValue: "7.2 %",
};

describe("Citation", () => {
  it("parses a well-formed citation", () => {
    const res = Citation.parse(valid);
    expect(res.sourceType).toBe("lab_pdf");
    expect(res.quoteOrValue).toBe("7.2 %");
    expect(res.locator).toBeUndefined();
    expect(res.corrected).toBeUndefined();
  });

  it.each(["sourceType", "sourceId", "pageOrSection", "fieldOrChunkId", "quoteOrValue"])(
    "rejects a citation missing required field %s",
    (field) => {
      const bad: Record<string, unknown> = { ...valid };
      delete bad[field];
      expect(Citation.safeParse(bad).success).toBe(false);
    },
  );

  it("rejects an unknown sourceType", () => {
    expect(Citation.safeParse({ ...valid, sourceType: "xray" }).success).toBe(false);
  });

  it("accepts sourceType chart and guideline", () => {
    expect(Citation.safeParse({ ...valid, sourceType: "chart" }).success).toBe(true);
    expect(Citation.safeParse({ ...valid, sourceType: "guideline" }).success).toBe(true);
  });

  it("accepts an optional in-range bounding-box locator", () => {
    const res = Citation.parse({ ...valid, locator: { page: 2, x: 0.1, y: 0.2, w: 0.3, h: 0.05 } });
    expect(res.locator).toEqual({ page: 2, x: 0.1, y: 0.2, w: 0.3, h: 0.05 });
  });

  it("rejects a locator with page < 1", () => {
    expect(Citation.safeParse({ ...valid, locator: { page: 0, x: 0.1, y: 0.1, w: 0.1, h: 0.1 } }).success).toBe(false);
  });

  it("rejects a locator with a coord outside [0,1]", () => {
    expect(Citation.safeParse({ ...valid, locator: { page: 1, x: 1.5, y: 0.1, w: 0.1, h: 0.1 } }).success).toBe(false);
  });

  it("accepts corrected:true (physician-edited)", () => {
    expect(Citation.parse({ ...valid, corrected: true }).corrected).toBe(true);
  });
});
