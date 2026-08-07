import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  createPdfRasterizer,
  PdfRasterizeError,
  type RenderPdfPages,
} from "../src/pdf/pdfRasterize.js";

const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF" — content ignored by the fake seam

describe("createPdfRasterizer — PdfRasterizePort over an injected renderer", () => {
  it("maps each rendered buffer to a PageImage with 1-based page numbers in order", async () => {
    const render: RenderPdfPages = async () => [Buffer.from("PNG_A"), Buffer.from("PNG_B")];
    const pages = await createPdfRasterizer({ renderPdfPages: render })(pdf);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toEqual({ page: 1, mediaType: "image/png", base64: Buffer.from("PNG_A").toString("base64") });
    expect(pages[1]).toEqual({ page: 2, mediaType: "image/png", base64: Buffer.from("PNG_B").toString("base64") });
  });

  it("forwards the configured scale to the renderer", async () => {
    let seenScale = -1;
    const render: RenderPdfPages = async (_pdf, scale) => {
      seenScale = scale;
      return [Buffer.from("x")];
    };
    await createPdfRasterizer({ renderPdfPages: render, scale: 3 })(pdf);
    expect(seenScale).toBe(3);
  });

  it("preserves a PdfRasterizeError thrown by the renderer unchanged (message not genericized)", async () => {
    const render: RenderPdfPages = async () => {
      throw new PdfRasterizeError("PDF has 99 pages, exceeding the 20-page limit");
    };
    try {
      await createPdfRasterizer({ renderPdfPages: render })(pdf);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(PdfRasterizeError);
      expect((e as PdfRasterizeError).message).toContain("99 pages");
    }
  });

  it("throws PdfRasterizeError on a zero-page render (never a silent empty set)", async () => {
    const render: RenderPdfPages = async () => [];
    await expect(createPdfRasterizer({ renderPdfPages: render })(pdf)).rejects.toBeInstanceOf(
      PdfRasterizeError,
    );
  });

  it("throws PdfRasterizeError when the page count exceeds maxPages", async () => {
    const render: RenderPdfPages = async () => Array.from({ length: 3 }, () => Buffer.from("x"));
    await expect(
      createPdfRasterizer({ renderPdfPages: render, maxPages: 2 })(pdf),
    ).rejects.toBeInstanceOf(PdfRasterizeError);
  });

  it("re-throws a renderer failure as a PHI-free PdfRasterizeError (no bytes, no cause)", async () => {
    const render: RenderPdfPages = async () => {
      throw new Error("boom carrying %PDF secret bytes");
    };
    try {
      await createPdfRasterizer({ renderPdfPages: render })(pdf);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(PdfRasterizeError);
      const err = e as PdfRasterizeError;
      expect(err.message).not.toContain("secret");
      expect(err.cause).toBeUndefined();
    }
  });

  it("rasterizes a real PDF handed in as a pooled Node Buffer (pdfjs ArrayBuffer-detach regression)", async () => {
    // The REAL renderer (no injected stub). Before the defensive `new Uint8Array(pdf)` copy, pdfjs
    // detached the pooled Buffer's shared ArrayBuffer and this threw "PDF rasterization failed" — the
    // exact failure that broke intake ingestion end-to-end. This guards the fix.
    const pdf = readFileSync(new URL("../../../packages/ingestion/fixtures/w2/susan-intake-form.pdf", import.meta.url));
    const pages = await createPdfRasterizer()(pdf);
    expect(pages.length).toBeGreaterThanOrEqual(1);
    expect(pages[0]?.base64.length ?? 0).toBeGreaterThan(0);
  }, 30000);
});
