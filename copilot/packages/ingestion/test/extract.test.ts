import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  extractLabPdf,
  extractIntakeForm,
  type PageImage,
  type VlmExtractPort,
  type VlmExtractRequest,
} from "../src/extract.js";
import { LabPdfExtraction } from "../src/schemas/labPdf.js";
import { IntakeFormExtraction } from "../src/schemas/intakeForm.js";

function loadFixture(name: string): unknown {
  const url = new URL(`../fixtures/w2/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8"));
}

const labGroundTruth = loadFixture("susan-lab-panel.extraction.json");
const intakeGroundTruth = loadFixture("susan-intake-form.extraction.json");

const pages: readonly PageImage[] = [{ page: 1, mediaType: "image/png", base64: "AAAA" }];

/** A port that returns a fixed sequence of raw outputs, one per attempt, recording each request. */
function scriptedPort(outputs: readonly unknown[]): {
  port: VlmExtractPort;
  requests: VlmExtractRequest[];
} {
  const requests: VlmExtractRequest[] = [];
  let i = 0;
  const port: VlmExtractPort = async (request) => {
    requests.push(request);
    // Repeat the last scripted output if called more times than scripted.
    const out = outputs[Math.min(i, outputs.length - 1)];
    i += 1;
    return out;
  };
  return { port, requests };
}

describe("VLM extraction engine — schema-canonical, bounded-retry-then-degrade", () => {
  it("well-formed lab output → ok on the first attempt, round-tripping the ground truth", async () => {
    const { port, requests } = scriptedPort([labGroundTruth]);
    const outcome = await extractLabPdf(port, pages);

    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") throw new Error("unreachable");
    expect(outcome.attempts).toBe(1);
    expect(outcome.extraction).toEqual(LabPdfExtraction.parse(labGroundTruth));
    // no feedback on a first, successful call
    expect(requests).toHaveLength(1);
    expect(requests[0]?.feedback).toBeUndefined();
    expect(requests[0]?.docType).toBe("lab_pdf");
  });

  it("well-formed intake output → ok on the first attempt", async () => {
    const { port } = scriptedPort([intakeGroundTruth]);
    const outcome = await extractIntakeForm(port, pages);

    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") throw new Error("unreachable");
    expect(outcome.attempts).toBe(1);
    expect(outcome.extraction).toEqual(IntakeFormExtraction.parse(intakeGroundTruth));
  });

  it("schema-invalid then valid → ok on attempt 2, with schema feedback fed back to the port", async () => {
    // Drop the citation from the first result: violates the canonical contract.
    const invalidLab = structuredClone(labGroundTruth) as { results: { citation?: unknown }[] };
    delete invalidLab.results[0]?.citation;

    const { port, requests } = scriptedPort([invalidLab, labGroundTruth]);
    const outcome = await extractLabPdf(port, pages);

    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") throw new Error("unreachable");
    expect(outcome.attempts).toBe(2);
    expect(requests).toHaveLength(2);
    // the retry request must carry the schema violation as feedback
    expect(requests[1]?.feedback).toBeTruthy();
    expect(requests[1]?.feedback).toMatch(/citation/i);
  });

  it("always-invalid → degraded (never throws, never returns an extraction), issues name the field", async () => {
    const invalidLab = structuredClone(labGroundTruth) as { results: { citation?: unknown }[] };
    delete invalidLab.results[0]?.citation;

    const { port, requests } = scriptedPort([invalidLab]); // repeats invalid every attempt
    const outcome = await extractLabPdf(port, pages, { maxAttempts: 2 });

    expect(outcome.status).toBe("degraded");
    if (outcome.status !== "degraded") throw new Error("unreachable");
    expect(outcome.attempts).toBe(2);
    expect(requests).toHaveLength(2);
    expect(outcome.issues.join(" ")).toMatch(/citation/i);
    expect(outcome).not.toHaveProperty("extraction");
  });

  it("maxAttempts: 1 → no retry, a single port call, degrade on first failure", async () => {
    const { port, requests } = scriptedPort([{ docType: "lab_pdf" }]); // missing results
    const outcome = await extractLabPdf(port, pages, { maxAttempts: 1 });

    expect(outcome.status).toBe("degraded");
    expect(outcome.attempts).toBe(1);
    expect(requests).toHaveLength(1);
  });

  it("a pathological maxAttempts (NaN) falls back to the default — never a zero-call silent drop", async () => {
    const { port, requests } = scriptedPort([{ docType: "lab_pdf" }]); // always invalid
    // NaN is a valid `number` at the type level, so it must be defended at runtime: the loop
    // must still run (and flag issues), never skip entirely and "degrade" with no model call.
    const outcome = await extractLabPdf(port, pages, { maxAttempts: Number.NaN });

    expect(outcome.status).toBe("degraded");
    if (outcome.status !== "degraded") throw new Error("unreachable");
    expect(requests.length).toBeGreaterThanOrEqual(1);
    expect(outcome.issues.length).toBeGreaterThan(0);
  });

  it("a port that throws (transport error) propagates — not swallowed as a degrade", async () => {
    const port: VlmExtractPort = async () => {
      throw new Error("network down");
    };
    await expect(extractLabPdf(port, pages)).rejects.toThrow(/network down/);
  });
});
