import { describe, it, expect } from "vitest";
import { normalizeOcrWords, type RawOcrWord } from "../src/ocrNormalize.js";

function raw(text: string, x0: number, y0: number, x1: number, y1: number): RawOcrWord {
  return { text, bbox: { x0, y0, x1, y1 } };
}

describe("normalizeOcrWords — pixel bbox → [0,1] OcrWord", () => {
  const W = 1000;
  const H = 2000;

  it("normalizes a pixel bbox to a rounded [0,1] box on the given page", () => {
    const [w] = normalizeOcrWords([raw("8.1", 400, 300, 440, 320)], W, H, 1);
    expect(w).toBeDefined();
    if (w === undefined) throw new Error("unreachable");
    expect(w.text).toBe("8.1");
    expect(w.box).toEqual({ page: 1, x: 0.4, y: 0.15, w: 0.04, h: 0.01 });
  });

  it("stamps the supplied page number on every box", () => {
    const [w] = normalizeOcrWords([raw("x", 0, 0, 10, 10)], W, H, 3);
    expect(w?.box.page).toBe(3);
  });

  it("drops words whose trimmed text is empty", () => {
    const out = normalizeOcrWords(
      [raw("", 0, 0, 10, 10), raw("   ", 0, 0, 10, 10), raw("Na", 20, 20, 40, 40)],
      W,
      H,
      1,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.text).toBe("Na");
  });

  it("clamps out-of-raster pixels into [0,1]", () => {
    const [w] = normalizeOcrWords([raw("edge", -50, -20, W + 100, H + 200)], W, H, 1);
    for (const c of [w!.box.x, w!.box.y, w!.box.w, w!.box.h]) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
    expect(w!.box.x).toBe(0);
    expect(w!.box.y).toBe(0);
  });

  it("preserves word order", () => {
    const out = normalizeOcrWords([raw("a", 0, 0, 1, 1), raw("b", 2, 2, 3, 3)], W, H, 1);
    expect(out.map((w) => w.text)).toEqual(["a", "b"]);
  });

  it("throws on a non-positive image dimension", () => {
    expect(() => normalizeOcrWords([raw("x", 0, 0, 1, 1)], 0, H, 1)).toThrow();
    expect(() => normalizeOcrWords([raw("x", 0, 0, 1, 1)], W, -1, 1)).toThrow();
  });

  it("throws on page < 1", () => {
    expect(() => normalizeOcrWords([raw("x", 0, 0, 1, 1)], W, H, 0)).toThrow();
  });

  it("drops a word whose bbox has a non-finite coordinate (never emits a NaN box)", () => {
    const out = normalizeOcrWords(
      [raw("bad", NaN, 0, 10, 10), raw("inf", 0, 0, Infinity, 10), raw("ok", 20, 20, 40, 40)],
      W,
      H,
      1,
    );
    expect(out.map((w) => w.text)).toEqual(["ok"]);
  });
});
