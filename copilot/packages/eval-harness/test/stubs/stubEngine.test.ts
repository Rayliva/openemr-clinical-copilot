/**
 * Spec + tests for the offline stub engine (T3, `docs/work-manifest.md`).
 *
 * Behavior (the spec these tests enforce):
 *  - `createStubEngine(opts?)` returns a `StubEngine` (frozen contract in `src/contracts.ts`).
 *  - `generate(prompt, caseId)` is a pure function of its inputs — same inputs → identical string,
 *    no clock / no randomness. Happy-path text carries a `[source:...]` provenance marker.
 *  - `extract(fixtureId)` routes on the fixture id ("lab" → `LabPdfExtraction`, "intake" →
 *    `IntakeFormExtraction`), returns a deterministic object that parses clean against the
 *    canonical ingestion schema, and throws on an unknown fixture id (fail loud, never a silent
 *    empty extraction).
 *  - `ocr(fixtureId)` returns a deterministic OCR word/box map that `parseOcrMap` accepts and that
 *    contains the extracted value tokens (so the box-match can locate them).
 *  - `injectRegression: true` flips every method to a deliberately WRONG output so the gate's
 *    "prove the red" self-test (S2) fails deterministically: `extract` → schema-invalid,
 *    `ocr` → malformed box (out of [0,1]) that `parseOcrMap` rejects, `generate` → an uncited claim
 *    (no `[source:...]` marker). Off/absent → happy path.
 *
 * Boundaries: the stub does NO IO — all data is embedded, so CI runs offline with no live key
 * (`.claude/rules/w2-eval-gate.md`). It is not the real VLM/LLM/OCR; it stands in for them.
 */
import { describe, it, expect } from "vitest";
import {
  LabPdfExtraction,
  IntakeFormExtraction,
  parseOcrMap,
  locateValue,
} from "@copilot/ingestion";
import { createStubEngine } from "../../src/stubs/index.js";

describe("createStubEngine — generate()", () => {
  it("is deterministic: same (prompt, caseId) → identical string", () => {
    const engine = createStubEngine();
    const a = engine.generate("summarize meds", "uc1-meds");
    const b = engine.generate("summarize meds", "uc1-meds");
    expect(a).toBe(b);
  });

  it("has no clock/randomness: repeated calls are byte-identical", () => {
    const engine = createStubEngine();
    const outputs = new Set(
      Array.from({ length: 25 }, () => engine.generate("p", "case-x")),
    );
    expect(outputs.size).toBe(1);
  });

  it("varies by caseId (keyed off the case)", () => {
    const engine = createStubEngine();
    expect(engine.generate("p", "case-a")).not.toBe(engine.generate("p", "case-b"));
  });

  it("happy-path text carries a [source:...] provenance marker", () => {
    const engine = createStubEngine();
    expect(engine.generate("p", "case-a")).toMatch(/\[source:/);
  });
});

describe("createStubEngine — extract()", () => {
  it("lab fixture parses clean against LabPdfExtraction", () => {
    const engine = createStubEngine();
    const parsed = LabPdfExtraction.parse(engine.extract("susan-lab-panel"));
    expect(parsed.docType).toBe("lab_pdf");
    expect(parsed.results.length).toBeGreaterThan(0);
  });

  it("intake fixture parses clean against IntakeFormExtraction", () => {
    const engine = createStubEngine();
    const parsed = IntakeFormExtraction.parse(engine.extract("susan-intake-form"));
    expect(parsed.docType).toBe("intake_form");
    expect(parsed.currentMedications.length).toBeGreaterThan(0);
  });

  it("routes on aliased ids (fixture- prefix, bare slug)", () => {
    const engine = createStubEngine();
    expect(LabPdfExtraction.safeParse(engine.extract("fixture-susan-lab-panel")).success).toBe(true);
    expect(IntakeFormExtraction.safeParse(engine.extract("intake")).success).toBe(true);
  });

  it("is deterministic: deep-equal across calls", () => {
    const engine = createStubEngine();
    expect(engine.extract("susan-lab-panel")).toEqual(engine.extract("susan-lab-panel"));
  });

  it("throws (fail loud) on an unknown fixture id", () => {
    const engine = createStubEngine();
    expect(() => engine.extract("unknown-doc")).toThrow();
  });
});

describe("createStubEngine — ocr()", () => {
  it("lab map is accepted by parseOcrMap", () => {
    const engine = createStubEngine();
    const page = parseOcrMap(engine.ocr("susan-lab-panel"));
    expect(page.words.length).toBeGreaterThan(0);
  });

  it("map contains the extracted value tokens (box-match can locate them)", () => {
    const engine = createStubEngine();
    const page = parseOcrMap(engine.ocr("susan-lab-panel"));
    // "8.1" (A1c) is a value on the lab panel; it must be locatable.
    expect(locateValue("8.1", page).state).toBe("located");
  });

  it("is deterministic: deep-equal across calls", () => {
    const engine = createStubEngine();
    expect(engine.ocr("susan-intake-form")).toEqual(engine.ocr("susan-intake-form"));
  });

  it("throws on an unknown fixture id", () => {
    const engine = createStubEngine();
    expect(() => engine.ocr("unknown-doc")).toThrow();
  });
});

describe("createStubEngine — injectRegression (prove-the-red)", () => {
  it("default is off: extract/ocr/generate are all happy-path", () => {
    const engine = createStubEngine();
    expect(engine.injectRegression ?? false).toBe(false);
    expect(LabPdfExtraction.safeParse(engine.extract("susan-lab-panel")).success).toBe(true);
    expect(() => parseOcrMap(engine.ocr("susan-lab-panel"))).not.toThrow();
    expect(engine.generate("p", "case-a")).toMatch(/\[source:/);
  });

  it("extract() emits schema-INVALID output when regression is injected", () => {
    const good = createStubEngine();
    const bad = createStubEngine({ injectRegression: true });
    expect(LabPdfExtraction.safeParse(good.extract("susan-lab-panel")).success).toBe(true);
    expect(LabPdfExtraction.safeParse(bad.extract("susan-lab-panel")).success).toBe(false);
    expect(IntakeFormExtraction.safeParse(bad.extract("susan-intake-form")).success).toBe(false);
  });

  it("ocr() emits a malformed (out-of-[0,1]) box that parseOcrMap rejects", () => {
    const bad = createStubEngine({ injectRegression: true });
    expect(() => parseOcrMap(bad.ocr("susan-lab-panel"))).toThrow();
  });

  it("generate() emits an UNCITED claim (no [source:...] marker)", () => {
    const good = createStubEngine();
    const bad = createStubEngine({ injectRegression: true });
    expect(good.generate("p", "case-a")).toMatch(/\[source:/);
    expect(bad.generate("p", "case-a")).not.toMatch(/\[source:/);
    expect(bad.generate("p", "case-a")).not.toBe(good.generate("p", "case-a"));
  });

  it("regression output is itself deterministic (self-test must be reliable)", () => {
    const bad = createStubEngine({ injectRegression: true });
    expect(bad.extract("susan-lab-panel")).toEqual(bad.extract("susan-lab-panel"));
    expect(bad.ocr("susan-lab-panel")).toEqual(bad.ocr("susan-lab-panel"));
    expect(bad.generate("p", "c")).toBe(bad.generate("p", "c"));
  });

  it("exposes the injectRegression flag on the engine", () => {
    expect(createStubEngine({ injectRegression: true }).injectRegression).toBe(true);
  });
});
