/**
 * Golden-set INGESTION cases — lab PDF extraction path (no live upload; the stub VLM/OCR keys off
 * `documentFixtureId`). Exercises `schema_valid` (the extraction parses against `LabPdfExtraction`),
 * `citation_present` (every derived value carries a source citation — the W2 no-fact-without-citation
 * rule), and `factually_consistent` (values match the committed ground-truth extraction).
 *
 * Reuses the committed W2 fixtures (Susan Underwood diabetes lab panel). `fixtureRefs` are paths
 * relative to the `copilot/` project root. Synthetic data only — see the fixtures README.
 */
import type { GoldenCase } from "@copilot/eval-harness";

const LAB_FIXTURE_ID = "fixture-susan-lab-panel";
const LAB_REFS = [
  "packages/ingestion/fixtures/w2/susan-lab-panel.pdf",
  "packages/ingestion/fixtures/w2/susan-lab-panel.page-1.png",
  "packages/ingestion/fixtures/w2/susan-lab-panel.page-1.ocr.json",
  "packages/ingestion/fixtures/w2/susan-lab-panel.extraction.json",
];

export const ingestionLabCases: GoldenCase[] = [
  {
    id: "ingest-lab-schema-valid",
    week: "week:2",
    category: ["schema_valid"],
    safety: false,
    input: { kind: "ingestion", documentFixtureId: LAB_FIXTURE_ID },
    fixtureRefs: LAB_REFS,
    expected: {
      note: "Extracted lab_pdf draft parses against LabPdfExtraction (strict) — no schema drift.",
    },
  },
  {
    id: "ingest-lab-every-value-cited",
    week: "week:2",
    category: ["citation_present"],
    safety: false,
    input: { kind: "ingestion", documentFixtureId: LAB_FIXTURE_ID },
    fixtureRefs: LAB_REFS,
    expected: {
      mustCite: true,
      note: "Each derived result (A1c, eGFR, LDL…) carries a page/section citation; no silent fill.",
    },
  },
  {
    id: "ingest-lab-a1c-value-consistent",
    week: "week:2",
    category: ["schema_valid", "factually_consistent"],
    safety: false,
    input: { kind: "ingestion", documentFixtureId: LAB_FIXTURE_ID },
    fixtureRefs: LAB_REFS,
    expected: {
      factuallyConsistent: true,
      note: "Hemoglobin A1c extracted as 8.1% (high) — matches the source text, not a hallucinated value.",
    },
  },
  {
    id: "ingest-lab-egfr-renal-flag",
    week: "week:2",
    category: ["factually_consistent"],
    safety: false,
    input: { kind: "ingestion", documentFixtureId: LAB_FIXTURE_ID },
    fixtureRefs: LAB_REFS,
    expected: {
      factuallyConsistent: true,
      note: "eGFR 45 mL/min (low) surfaced with its abnormal flag from the document; renal signal preserved.",
    },
  },
  {
    id: "ingest-lab-abnormal-flags-preserved",
    week: "week:2",
    category: ["schema_valid", "citation_present"],
    safety: false,
    input: { kind: "ingestion", documentFixtureId: LAB_FIXTURE_ID },
    fixtureRefs: LAB_REFS,
    expected: {
      mustCite: true,
      note: "High/low flags on each result are captured and cited, not inferred or dropped.",
    },
  },
  {
    id: "ingest-lab-idempotent-reingest",
    week: "week:2",
    category: ["schema_valid"],
    safety: false,
    input: { kind: "ingestion", documentFixtureId: LAB_FIXTURE_ID },
    fixtureRefs: LAB_REFS,
    expected: {
      note: "Re-ingesting the same PDF (hash match) yields the same schema-valid draft — no duplicate record.",
    },
  },
];
