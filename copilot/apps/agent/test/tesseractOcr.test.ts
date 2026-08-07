import { describe, it, expect } from "vitest";
import type { PageImage } from "@copilot/ingestion";
import {
  createTesseractOcr,
  flattenTesseractWords,
  pngSize,
  OcrTransportError,
  type RecognizeResult,
  type RunRecognize,
} from "../src/ocr/tesseractOcr.js";

/** A minimal valid PNG header buffer (signature + IHDR length/type + width/height). */
function pngHeader(width: number, height: number): Buffer {
  const buf = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8); // IHDR chunk length
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

const page = (n: number): PageImage => ({ page: n, mediaType: "image/png", base64: `PAGE${n}` });

describe("createTesseractOcr — OcrPort over an injected recognizer", () => {
  it("normalizes and stamps the page number for a single page", async () => {
    const recog: RunRecognize = async (): Promise<RecognizeResult> => ({
      width: 1000,
      height: 2000,
      words: [{ text: "8.1", bbox: { x0: 400, y0: 300, x1: 440, y1: 320 } }],
    });
    const ocr = createTesseractOcr({ runRecognize: recog });
    const out = await ocr({ pages: [page(1)] });
    expect(out.words).toHaveLength(1);
    expect(out.words[0]).toEqual({ text: "8.1", box: { page: 1, x: 0.4, y: 0.15, w: 0.04, h: 0.01 } });
  });

  it("merges words across pages, stamping each page's number (page # comes from the adapter)", async () => {
    const recog: RunRecognize = async (): Promise<RecognizeResult> => ({
      width: 100,
      height: 100,
      words: [{ text: "value", bbox: { x0: 10, y0: 10, x1: 20, y1: 20 } }],
    });
    const ocr = createTesseractOcr({ runRecognize: recog });
    const out = await ocr({ pages: [page(1), page(2)] });
    // One word per page, each stamped with the PageImage's own page number by the adapter.
    expect(out.words.map((w) => w.box.page)).toEqual([1, 2]);
    expect(out.words).toHaveLength(2);
  });

  it("drops empty-text words via the pure normalizer", async () => {
    const recog: RunRecognize = async (): Promise<RecognizeResult> => ({
      width: 100,
      height: 100,
      words: [
        { text: "  ", bbox: { x0: 0, y0: 0, x1: 5, y1: 5 } },
        { text: "Na", bbox: { x0: 10, y0: 10, x1: 20, y1: 20 } },
      ],
    });
    const out = await createTesseractOcr({ runRecognize: recog })({ pages: [page(1)] });
    expect(out.words.map((w) => w.text)).toEqual(["Na"]);
  });

  it("re-throws a recognizer failure as a PHI-free OcrTransportError (no image bytes)", async () => {
    const recog: RunRecognize = async (image) => {
      throw new Error(`boom with secret bytes ${image.toString("base64")}`);
    };
    const ocr = createTesseractOcr({ runRecognize: recog });
    await expect(ocr({ pages: [page(1)] })).rejects.toBeInstanceOf(OcrTransportError);
    try {
      await ocr({ pages: [page(1)] });
    } catch (e) {
      expect(e).toBeInstanceOf(OcrTransportError);
      const err = e as OcrTransportError;
      expect(err.message).toBe("OCR failed for page 1");
      expect(err.message).not.toContain("secret");
      expect(err.cause).toBeUndefined();
    }
  });

  it("surfaces a numeric statusCode from the underlying error when present", async () => {
    const recog: RunRecognize = async () => {
      throw Object.assign(new Error("nope"), { statusCode: 503 });
    };
    try {
      await createTesseractOcr({ runRecognize: recog })({ pages: [page(1)] });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as OcrTransportError).statusCode).toBe(503);
    }
  });

  it("fails fast on an empty pages list (caller bug, not a silent empty map)", async () => {
    const recog: RunRecognize = async () => ({ width: 1, height: 1, words: [] });
    await expect(createTesseractOcr({ runRecognize: recog })({ pages: [] })).rejects.toThrow();
  });
});

describe("pngSize — IHDR dimension read with signature guard", () => {
  it("reads width/height from a valid PNG header", () => {
    expect(pngSize(pngHeader(1632, 2112))).toEqual({ width: 1632, height: 2112 });
  });

  it("throws on a non-PNG buffer (wrong signature)", () => {
    expect(() => pngSize(Buffer.alloc(24, 0))).toThrow();
  });

  it("throws on a truncated buffer", () => {
    expect(() => pngSize(pngHeader(100, 100).subarray(0, 20))).toThrow();
  });
});

describe("flattenTesseractWords — v7 tree flatten with bbox guards", () => {
  const tree = (words: unknown[]): unknown => ({ blocks: [{ paragraphs: [{ lines: [{ words }] }] }] });

  it("flattens well-formed words", () => {
    const out = flattenTesseractWords(tree([{ text: "A1c", bbox: { x0: 1, y0: 2, x1: 3, y1: 4 } }]));
    expect(out).toEqual([{ text: "A1c", bbox: { x0: 1, y0: 2, x1: 3, y1: 4 } }]);
  });

  it("returns [] for an empty or missing tree", () => {
    expect(flattenTesseractWords({})).toEqual([]);
    expect(flattenTesseractWords({ blocks: [{}] })).toEqual([]);
  });

  it("drops words with non-string text or a non-finite/absent bbox", () => {
    const out = flattenTesseractWords(
      tree([
        { text: 42, bbox: { x0: 1, y0: 2, x1: 3, y1: 4 } }, // non-string text
        { text: "noBox" }, // absent bbox
        { text: "nan", bbox: { x0: NaN, y0: 2, x1: 3, y1: 4 } }, // non-finite coord
        { text: "ok", bbox: { x0: 1, y0: 2, x1: 3, y1: 4 } },
      ]),
    );
    expect(out.map((w) => w.text)).toEqual(["ok"]);
  });
});
