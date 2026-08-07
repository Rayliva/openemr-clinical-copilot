import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ingestLabDocument, type LabIngestionDeps } from "../src/pipeline.js";
import { parseOcrMap } from "../src/ocrMap.js";
import { fromOcrMap } from "../src/ocrPort.js";
import type { PendingDocument } from "../src/detect.js";
import type { PageImage } from "../src/extract.js";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/w2");
const load = (name: string): unknown => JSON.parse(readFileSync(resolve(dir, name), "utf8"));

const labExtraction = load("susan-lab-panel.extraction.json");
const ocrMap = parseOcrMap(load("susan-lab-panel.page-1.ocr.json"));
const pngBase64 = readFileSync(resolve(dir, "susan-lab-panel.page-1.png")).toString("base64");
const stubPages: readonly PageImage[] = [{ page: 1, mediaType: "image/png", base64: pngBase64 }];

const doc: PendingDocument = {
  documentId: "doc-1",
  binaryId: "bin-1",
  contentType: "application/pdf",
  title: "susan-lab-panel.pdf",
};

/** Deps wired to the committed fixture — the whole flow runs offline, no live engines. */
function fixtureDeps(over: Partial<LabIngestionDeps> = {}): LabIngestionDeps {
  return {
    fetchBinary: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]), // "%PDF" — stub rasterizer ignores
    rasterize: async () => stubPages,
    vlm: async () => labExtraction, // canned VLM output = the committed ground truth
    ocr: fromOcrMap(ocrMap),
    ...over,
  };
}

describe("ingestLabDocument — the lab ingestion pipeline (offline)", () => {
  it("produces an ok draft: 8 located results + the page carried for the overlay", async () => {
    const draft = await ingestLabDocument(doc, fixtureDeps());
    expect(draft.status).toBe("ok");
    if (draft.status !== "ok") throw new Error("unreachable");
    expect(draft.documentId).toBe("doc-1");
    expect(draft.pages).toHaveLength(1);
    expect(draft.results).toHaveLength(8);
    const a1c = draft.results.find((r) => r.result.testName === "Hemoglobin A1c");
    expect(a1c?.match.state).toBe("located");
    expect(a1c?.result.citation.locator).toBeDefined();
  });

  it("degrades (no results) when the VLM output is schema-invalid — pages still carried, OCR not run", async () => {
    const draft = await ingestLabDocument(
      doc,
      fixtureDeps({
        vlm: async () => ({ nonsense: true }),
        // OCR must not run on an invalid extraction — a throw here proves the skip is observable.
        ocr: async () => { throw new Error("ocr must not run on a degraded extraction"); },
      }),
    );
    expect(draft.status).toBe("degraded");
    if (draft.status !== "degraded") throw new Error("unreachable");
    expect(draft.issues.length).toBeGreaterThan(0);
    expect(draft.pages).toHaveLength(1);
    expect(draft.title).toBe("susan-lab-panel.pdf");
  });

  it("degrades when the rasterizer yields zero pages (no hollow ok)", async () => {
    const draft = await ingestLabDocument(doc, fixtureDeps({ rasterize: async () => [] }));
    expect(draft.status).toBe("degraded");
  });

  it("still returns ok with all values forced to review when OCR yields no words (no dropped citation)", async () => {
    const draft = await ingestLabDocument(doc, fixtureDeps({ ocr: async () => ({ words: [] }) }));
    expect(draft.status).toBe("ok");
    if (draft.status !== "ok") throw new Error("unreachable");
    expect(draft.results).toHaveLength(8);
    expect(draft.results.every((r) => r.match.state === "unverified")).toBe(true);
    expect(draft.results.every((r) => r.result.citation.pageOrSection.length > 0)).toBe(true);
  });

  it("propagates an infra failure (fetchBinary or rasterize rejects) rather than swallowing it", async () => {
    await expect(
      ingestLabDocument(doc, fixtureDeps({ fetchBinary: async () => { throw new Error("binary 404"); } })),
    ).rejects.toThrow();
    await expect(
      ingestLabDocument(doc, fixtureDeps({ rasterize: async () => { throw new Error("render failed"); } })),
    ).rejects.toThrow();
  });
});
