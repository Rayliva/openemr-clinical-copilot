import { describe, it, expect } from "vitest";
import { ingestMedicationListDocument, type LabIngestionDeps } from "../src/pipeline.js";
import type { PendingDocument } from "../src/detect.js";
import type { PageImage } from "../src/extract.js";
import type { OcrPage, OcrWord } from "../src/boxMatch.js";

const doc: PendingDocument = {
  documentId: "doc-med-1",
  binaryId: "bin-med-1",
  contentType: "application/pdf",
  title: "bello-grace-medication-list.pdf",
};

const cite = (q: string) => ({
  sourceType: "medication_list",
  sourceId: "med-1",
  pageOrSection: "Medications",
  fieldOrChunkId: "meds",
  quoteOrValue: q,
});

const w = (text: string, x: number): OcrWord => ({ text, box: { page: 1, x, y: 0.5, w: 0.06, h: 0.02 } });
const ocrPage: OcrPage = { words: [w("Propranolol", 0.1), w("40", 0.2), w("mg", 0.26), w("twice", 0.32), w("daily", 0.4)] };
const stubPages: readonly PageImage[] = [{ page: 1, mediaType: "image/png", base64: "aGVsbG8=" }];

const canned = {
  docType: "medication_list",
  medications: [
    { name: "Propranolol", dose: "40 mg", frequency: "twice daily", status: "active", citation: cite("Propranolol 40 mg twice daily"), confidence: 0.97 },
  ],
  citation: cite("Medication List"),
};

/** Fully offline deps — no live VLM/OCR/network, no fixture files. */
function deps(over: Partial<LabIngestionDeps> = {}): LabIngestionDeps {
  return {
    fetchBinary: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    rasterize: async () => stubPages,
    vlm: async () => canned,
    ocr: async () => ocrPage,
    ...over,
  };
}

describe("ingestMedicationListDocument — the third document pipeline (offline)", () => {
  it("produces an ok draft of the lab shape: numbered, located medications, page carried", async () => {
    const draft = await ingestMedicationListDocument(doc, deps());
    expect(draft.status).toBe("ok");
    if (draft.status !== "ok") throw new Error("unreachable");
    expect(draft.documentId).toBe("doc-med-1");
    expect(draft.pages).toHaveLength(1);
    expect(draft.results).toHaveLength(1);
    expect(draft.results[0]!.result.testName).toBe("Medication 1");
    expect(draft.results[0]!.result.value).toBe("Propranolol 40 mg twice daily (active)");
    expect(draft.results[0]!.match.state).toBe("located");
  });

  it("degrades (no results) when the VLM output is schema-invalid — pages carried, OCR not run", async () => {
    const draft = await ingestMedicationListDocument(
      doc,
      deps({
        vlm: async () => ({ nonsense: true }),
        ocr: async () => {
          throw new Error("ocr must not run on a degraded extraction");
        },
      }),
    );
    expect(draft.status).toBe("degraded");
    if (draft.status !== "degraded") throw new Error("unreachable");
    expect(draft.issues.length).toBeGreaterThan(0);
    expect(draft.pages).toHaveLength(1);
  });

  it("degrades when the rasterizer yields zero pages (no hollow ok)", async () => {
    const draft = await ingestMedicationListDocument(doc, deps({ rasterize: async () => [] }));
    expect(draft.status).toBe("degraded");
  });

  it("still returns ok with values forced to review when OCR yields no words (no dropped citation)", async () => {
    const draft = await ingestMedicationListDocument(doc, deps({ ocr: async () => ({ words: [] }) }));
    expect(draft.status).toBe("ok");
    if (draft.status !== "ok") throw new Error("unreachable");
    expect(draft.results[0]!.match.state).toBe("unverified");
    expect(draft.results[0]!.result.citation.pageOrSection.length).toBeGreaterThan(0);
  });

  it("propagates an infra failure (fetchBinary rejects) rather than swallowing it", async () => {
    await expect(
      ingestMedicationListDocument(doc, deps({ fetchBinary: async () => { throw new Error("binary 404"); } })),
    ).rejects.toThrow();
  });
});
