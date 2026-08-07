import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { NoObjectGeneratedError } from "ai";
import { LabPdfExtraction, IntakeFormExtraction, extractLabPdf, type PageImage } from "@copilot/ingestion";
import {
  buildVlmMessages,
  selectExtractionSchema,
  createClaudeVlm,
  VlmTransportError,
  type RunGenerate,
} from "../src/anthropic/claudeVlm.js";

function loadFixture(name: string): unknown {
  const url = new URL(`../../../packages/ingestion/fixtures/w2/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8"));
}
const labGroundTruth = loadFixture("susan-lab-panel.extraction.json");

const pages: readonly PageImage[] = [
  { page: 1, mediaType: "image/png", base64: "IMG1" },
  { page: 2, mediaType: "image/jpeg", base64: "IMG2" },
];

/** A NoObjectGeneratedError with just enough metadata to be a real instance. */
function noObjectError(text: string | undefined): NoObjectGeneratedError {
  return new NoObjectGeneratedError({
    text,
    response: { id: "r", timestamp: new Date(0), modelId: "m" },
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    finishReason: "stop",
  });
}

describe("buildVlmMessages", () => {
  it("builds one image part per page (mapping mediaType→mimeType) plus a text instruction", () => {
    const { messages } = buildVlmMessages({ docType: "lab_pdf", pages });
    expect(messages).toHaveLength(1);
    const content = messages[0]?.content;
    expect(Array.isArray(content)).toBe(true);
    const parts = content as Array<{ type: string; image?: unknown; mimeType?: string; text?: string }>;
    const images = parts.filter((p) => p.type === "image");
    expect(images).toHaveLength(2);
    expect(images[0]).toMatchObject({ image: "IMG1", mimeType: "image/png" });
    expect(images[1]).toMatchObject({ image: "IMG2", mimeType: "image/jpeg" });
    expect(parts.some((p) => p.type === "text" && (p.text ?? "").length > 0)).toBe(true);
  });

  it("without feedback, does not include any revision text", () => {
    const { system, messages } = buildVlmMessages({ docType: "lab_pdf", pages });
    const text = JSON.stringify(messages) + system;
    expect(text.toLowerCase()).not.toContain("previous");
  });

  it("with feedback, threads the schema-violation text into the prompt", () => {
    const { messages } = buildVlmMessages({
      docType: "lab_pdf",
      pages,
      feedback: "results.0.citation: Required",
    });
    expect(JSON.stringify(messages)).toContain("results.0.citation: Required");
  });

  it("the system prompt forbids inventing values not on the page", () => {
    const { system } = buildVlmMessages({ docType: "intake_form", pages });
    expect(system.toLowerCase()).toMatch(/do not|never/);
    expect(system.toLowerCase()).toMatch(/invent|infer|not on the page|printed/);
  });
});

describe("selectExtractionSchema", () => {
  it("maps lab_pdf → LabPdfExtraction and intake_form → IntakeFormExtraction", () => {
    expect(selectExtractionSchema("lab_pdf")).toBe(LabPdfExtraction);
    expect(selectExtractionSchema("intake_form")).toBe(IntakeFormExtraction);
  });
});

describe("createClaudeVlm (port behavior, offline via injected runGenerate)", () => {
  it("returns the model object on success and satisfies the VlmExtractPort contract", async () => {
    const run: RunGenerate = async () => labGroundTruth;
    const port = createClaudeVlm({ apiKey: "k", model: "claude-opus-4-8", runGenerate: run });

    // used directly by the engine → a clean ok outcome
    const outcome = await extractLabPdf(port, pages);
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") throw new Error("unreachable");
    expect(outcome.extraction).toEqual(LabPdfExtraction.parse(labGroundTruth));
  });

  it("on NoObjectGeneratedError, returns the raw text (engine rejects it) — never throws, never bypasses", async () => {
    const run: RunGenerate = async () => {
      throw noObjectError('{"docType":"lab_pdf"}'); // valid JSON but schema-incomplete (no results)
    };
    const port = createClaudeVlm({ apiKey: "k", model: "m", runGenerate: run });

    const raw = await port({ docType: "lab_pdf", pages });
    expect(raw).toEqual({ docType: "lab_pdf" }); // handed back for the engine to reject

    // and end-to-end the engine degrades (does not throw) rather than committing junk
    const outcome = await extractLabPdf(port, pages, { maxAttempts: 1 });
    expect(outcome.status).toBe("degraded");
  });

  it("on a non-schema (transport) error, propagates as a PHI-free VlmTransportError", async () => {
    const run: RunGenerate = async () => {
      throw new Error("429 rate limited");
    };
    const port = createClaudeVlm({ apiKey: "k", model: "m", runGenerate: run });
    await expect(port({ docType: "lab_pdf", pages })).rejects.toBeInstanceOf(VlmTransportError);
    await expect(port({ docType: "lab_pdf", pages })).rejects.toThrow(/rate limited/);
  });

  it("a propagated transport error never carries the base64 page image (no PHI leak)", async () => {
    // Simulate an Anthropic APICallError whose requestBodyValues holds the page raster.
    const run: RunGenerate = async () => {
      const err = Object.assign(new Error("Internal server error"), {
        statusCode: 500,
        requestBodyValues: { messages: [{ content: [{ type: "image", image: "SECRET_BASE64_IMAGE" }] }] },
        responseBody: "SECRET_BASE64_IMAGE",
      });
      throw err;
    };
    const port = createClaudeVlm({ apiKey: "k", model: "m", runGenerate: run });
    const caught = await port({ docType: "lab_pdf", pages }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(caught).toBeInstanceOf(VlmTransportError);
    const serialized = JSON.stringify(caught, Object.getOwnPropertyNames(caught)) + String(caught);
    expect(serialized).not.toContain("SECRET_BASE64_IMAGE");
    expect(caught).not.toHaveProperty("requestBodyValues");
    expect((caught as VlmTransportError).statusCode).toBe(500);
  });

  it("throws fast on a document with no page images (caller bug, not a model failure)", async () => {
    const run: RunGenerate = async () => labGroundTruth;
    const port = createClaudeVlm({ apiKey: "k", model: "m", runGenerate: run });
    await expect(port({ docType: "lab_pdf", pages: [] })).rejects.toThrow(/no page images/);
  });
});
