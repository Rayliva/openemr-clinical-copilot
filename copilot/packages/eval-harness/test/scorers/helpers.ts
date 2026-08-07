/** Test builders for scorer specs — minimal valid `CaseRunOutput` / `GoldenCase` with overrides. */

import type {
  CaseRunOutput,
  GoldenCase,
  RubricCategory,
} from "../../src/contracts.js";
import type { Citation } from "@copilot/ingestion";

export function makeOutput(overrides: Partial<CaseRunOutput> = {}): CaseRunOutput {
  return {
    caseId: "case-1",
    kind: "chat",
    text: "answer",
    citations: [],
    structured: {},
    logs: [],
    refused: false,
    retrievedRowIds: [],
    ...overrides,
  };
}

export function makeCase(overrides: Partial<GoldenCase> = {}): GoldenCase {
  const category: [RubricCategory, ...RubricCategory[]] = overrides.category ?? ["schema_valid"];
  return {
    id: "case-1",
    week: "week:2",
    category,
    safety: false,
    input: { kind: "chat", pid: 1, message: "hi" },
    fixtureRefs: [],
    expected: {},
    ...overrides,
  };
}

/** A well-formed ingestion `Citation` (every extracted value needs one). */
export function makeCitation(overrides: Partial<Citation> = {}): Citation {
  return {
    sourceType: "lab_pdf",
    sourceId: "doc-1",
    pageOrSection: "page 1",
    fieldOrChunkId: "field-1",
    quoteOrValue: "12.3",
    ...overrides,
  };
}
