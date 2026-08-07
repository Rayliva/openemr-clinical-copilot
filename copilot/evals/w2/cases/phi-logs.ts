/**
 * Golden-set cases — `no_phi_in_logs` (non-safety breadth across both kinds). The captured run logs
 * must never contain the patient's PHI substrings even though the answer/extraction legitimately
 * handles them (minimum-necessary to the LLM; PHI stays in-boundary — `.claude/rules/phi-and-secrets.md`).
 * The safety-tagged PHI-in-logs guarantees live in chat-safety.ts / ingestion-safety.ts. Synthetic only.
 */
import type { GoldenCase } from "@copilot/eval-harness";

const SUSAN_PHI = ["Susan Underwood", "Underwood", "03/14/1958", "(512) 555-0148"];

export const phiLogCases: GoldenCase[] = [
  {
    id: "phi-logs-chat-meds",
    week: "week:2",
    category: ["no_phi_in_logs"],
    safety: false,
    input: { kind: "chat", pid: 2, message: "List her medications with doses." },
    fixtureRefs: [],
    expected: {
      forbiddenInLogs: SUSAN_PHI,
      note: "Med answer may name the patient; the structured logs must not carry name/DOB/phone.",
    },
  },
  {
    id: "phi-logs-chat-problems",
    week: "week:2",
    category: ["no_phi_in_logs"],
    safety: false,
    input: { kind: "chat", pid: 2, message: "What's on her problem list?" },
    fixtureRefs: [],
    expected: {
      forbiddenInLogs: SUSAN_PHI,
      note: "Problem-list turn logs a correlation id + pid, never the patient's identifying PHI.",
    },
  },
  {
    id: "phi-logs-ingest-lab",
    week: "week:2",
    category: ["no_phi_in_logs"],
    safety: false,
    input: { kind: "ingestion", documentFixtureId: "fixture-susan-lab-panel" },
    fixtureRefs: [
      "packages/ingestion/fixtures/w2/susan-lab-panel.page-1.ocr.json",
      "packages/ingestion/fixtures/w2/susan-lab-panel.extraction.json",
    ],
    expected: {
      forbiddenInLogs: SUSAN_PHI,
      note: "Lab ingestion trace logs fixture id + counts, not the patient identity on the report.",
    },
  },
  {
    id: "phi-logs-ingest-intake",
    week: "week:2",
    category: ["no_phi_in_logs"],
    safety: false,
    input: { kind: "ingestion", documentFixtureId: "fixture-susan-intake-form" },
    fixtureRefs: [
      "packages/ingestion/fixtures/w2/susan-intake-form.page-1.ocr.json",
      "packages/ingestion/fixtures/w2/susan-intake-form.extraction.json",
    ],
    expected: {
      forbiddenInLogs: SUSAN_PHI,
      note: "Intake ingestion is PHI-dense; the run logs must still contain none of it.",
    },
  },
];
