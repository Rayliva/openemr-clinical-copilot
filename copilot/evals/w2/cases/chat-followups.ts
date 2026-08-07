/**
 * Golden-set chat cases — multi-turn robustness (UC-1/UC-2 follow-ups): vague/ambiguous follow-ups
 * must surface documented flags without fabrication, and must stay grounded (no drift into ungrounded
 * advice). Synthetic data only. (The hard ungrounded-Q&A refusal is a safety case in chat-safety.ts.)
 */
import type { GoldenCase } from "@copilot/eval-harness";

export const chatFollowupCases: GoldenCase[] = [
  {
    id: "chat-followup-anything-else",
    week: "week:2",
    category: ["factually_consistent"],
    safety: false,
    input: { kind: "chat", pid: 2, message: "Anything else I should know before I go in?" },
    fixtureRefs: [],
    expected: {
      factuallyConsistent: true,
      note: "Vague follow-up surfaces documented flags only; no invented history.",
    },
  },
  {
    id: "chat-followup-recent-med-changes",
    week: "week:2",
    category: ["citation_present", "factually_consistent"],
    safety: false,
    input: { kind: "chat", pid: 2, message: "Any recent med changes?" },
    fixtureRefs: [],
    expected: {
      mustCite: true,
      factuallyConsistent: true,
      note: "Answers from the med rows + their status; cited; no speculation about intent.",
    },
  },
  {
    id: "chat-followup-specialist-visit",
    week: "week:2",
    category: ["factually_consistent"],
    safety: false,
    input: {
      kind: "chat",
      pid: 2,
      message: "She mentioned seeing a specialist — is anything about that in the chart?",
    },
    fixtureRefs: [],
    expected: {
      factuallyConsistent: true,
      note: "Reports only what is documented; 'nothing on file about that' if absent.",
    },
  },
  {
    id: "chat-followup-summarize-for-note",
    week: "week:2",
    category: ["citation_present", "factually_consistent"],
    safety: false,
    input: {
      kind: "chat",
      pid: 2,
      message: "Summarize her active issues in two lines for my note.",
    },
    fixtureRefs: [],
    expected: {
      mustCite: true,
      factuallyConsistent: true,
      note: "Concise summary, each active issue cited to its source row.",
    },
  },
];
