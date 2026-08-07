/**
 * Golden-set INGESTION cases — patient intake-form extraction path (stub VLM/OCR keys off
 * `documentFixtureId`). Exercises `schema_valid` (parses against `IntakeFormExtraction`),
 * `citation_present` (demographics / meds / allergies each carry a citation), and
 * `factually_consistent` (values match the committed ground-truth extraction — incl. the documented
 * Penicillin allergy that drives the contraindication safety case).
 *
 * Reuses the committed W2 fixtures (Susan Underwood intake form). Synthetic data only.
 */
import type { GoldenCase } from "@copilot/eval-harness";

const INTAKE_FIXTURE_ID = "fixture-susan-intake-form";
const INTAKE_REFS = [
  "packages/ingestion/fixtures/w2/susan-intake-form.pdf",
  "packages/ingestion/fixtures/w2/susan-intake-form.page-1.png",
  "packages/ingestion/fixtures/w2/susan-intake-form.page-1.ocr.json",
  "packages/ingestion/fixtures/w2/susan-intake-form.extraction.json",
];

export const ingestionIntakeCases: GoldenCase[] = [
  {
    id: "ingest-intake-schema-valid",
    week: "week:2",
    category: ["schema_valid"],
    safety: false,
    input: { kind: "ingestion", documentFixtureId: INTAKE_FIXTURE_ID },
    fixtureRefs: INTAKE_REFS,
    expected: {
      note: "Extracted intake_form draft parses against IntakeFormExtraction (strict).",
    },
  },
  {
    id: "ingest-intake-demographics-cited",
    week: "week:2",
    category: ["schema_valid", "citation_present"],
    safety: false,
    input: { kind: "ingestion", documentFixtureId: INTAKE_FIXTURE_ID },
    fixtureRefs: INTAKE_REFS,
    expected: {
      mustCite: true,
      note: "Demographics + chief concern carry a citation to their section on the page.",
    },
  },
  {
    id: "ingest-intake-meds-cited",
    week: "week:2",
    category: ["citation_present", "factually_consistent"],
    safety: false,
    input: { kind: "ingestion", documentFixtureId: INTAKE_FIXTURE_ID },
    fixtureRefs: INTAKE_REFS,
    expected: {
      mustCite: true,
      factuallyConsistent: true,
      note: "Metformin/Lisinopril/Atorvastatin extracted with doses matching the form; each cited.",
    },
  },
  {
    id: "ingest-intake-allergy-consistent",
    week: "week:2",
    category: ["schema_valid", "factually_consistent"],
    safety: false,
    input: { kind: "ingestion", documentFixtureId: INTAKE_FIXTURE_ID },
    fixtureRefs: INTAKE_REFS,
    expected: {
      factuallyConsistent: true,
      note: "Penicillin allergy (reaction: rash) extracted exactly as documented — feeds the contraindication check.",
    },
  },
  {
    id: "ingest-intake-family-history",
    week: "week:2",
    category: ["citation_present"],
    safety: false,
    input: { kind: "ingestion", documentFixtureId: INTAKE_FIXTURE_ID },
    fixtureRefs: INTAKE_REFS,
    expected: {
      mustCite: true,
      note: "Family-history entries (father T2DM, mother HTN) each carry a citation; none invented.",
    },
  },
  {
    id: "ingest-intake-derived-from-source",
    week: "week:2",
    category: ["schema_valid"],
    safety: false,
    input: { kind: "ingestion", documentFixtureId: INTAKE_FIXTURE_ID },
    fixtureRefs: INTAKE_REFS,
    expected: {
      note: "Derived draft links derivedFrom the source DocumentReference (traceable, idempotent write).",
    },
  },
];
