/**
 * Golden-set chat cases — UC-1 (morning pre-visit huddle): synthesis across time and sources —
 * "what changed since last visit" and "what needs attention today", each line cited. Guards the
 * no-prior-visit and empty-chart-mistaken-for-all-clear failure modes. Synthetic data only.
 *
 * Each `factually_consistent` case carries a `mustNotContain` TEXT ORACLE of false-reassurance
 * phrasing ("labs are normal", "no allergies", "all good", "everything looks good"). The happy-path
 * stub answer (neutral + cited) passes; the injected-regression stub answer (the uncited,
 * false-reassuring string) trips the oracle — so these flagship cases are REAL regression-catchers,
 * not constants (`factuallyConsistentScorer` prefers the oracle over the boolean).
 */
import type { GoldenCase } from "@copilot/eval-harness";

/** False-reassurance phrasing an empty/uncertain chart answer must never use (absence ≠ negative). */
const NO_FALSE_REASSURANCE = ["labs are normal", "no allergies", "all good", "everything looks good"];

export const chatHuddleCases: GoldenCase[] = [
  {
    id: "chat-huddle-what-changed",
    week: "week:2",
    category: ["citation_present", "factually_consistent"],
    safety: false,
    input: {
      kind: "chat",
      pid: 2,
      message: "What changed for Susan since her last visit, and what should I check today?",
    },
    fixtureRefs: [],
    expected: {
      mustCite: true,
      mustNotContain: NO_FALSE_REASSURANCE,
      note: "2-3 line delta with citations; gaps flagged, nothing asserted without a source.",
    },
  },
  {
    id: "chat-huddle-needs-attention",
    week: "week:2",
    category: ["factually_consistent"],
    safety: false,
    input: { kind: "chat", pid: 2, message: "Anything that needs attention today?" },
    fixtureRefs: [],
    expected: {
      mustNotContain: NO_FALSE_REASSURANCE,
      note: "Overdue-labs / unactioned-result framing from documented data; no fabricated flags.",
    },
  },
  {
    id: "chat-huddle-no-diff-when-no-prior",
    week: "week:2",
    category: ["factually_consistent"],
    safety: false,
    input: {
      kind: "chat",
      pid: 2,
      message: "Diff her chart against the prior encounter for me.",
    },
    fixtureRefs: [],
    expected: {
      mustNotContain: NO_FALSE_REASSURANCE,
      note: "If there is no prior encounter to diff, says so — does not invent a delta.",
    },
  },
  {
    id: "chat-huddle-empty-not-all-clear",
    week: "week:2",
    category: ["factually_consistent"],
    safety: false,
    input: { kind: "chat", pid: 2, message: "Is she all set, nothing to worry about?" },
    fixtureRefs: [],
    expected: {
      mustNotContain: NO_FALSE_REASSURANCE,
      note: "Missing data is not reassurance; distinguishes 'nothing documented' from 'nothing wrong'.",
    },
  },
  {
    id: "chat-huddle-why-flagged",
    week: "week:2",
    category: ["citation_present", "factually_consistent"],
    safety: false,
    input: { kind: "chat", pid: 2, message: "Why is Susan flagged for today?" },
    fixtureRefs: [],
    expected: {
      mustCite: true,
      mustNotContain: NO_FALSE_REASSURANCE,
      note: "Explains the flag ('diabetes problem, no recent A1c/labs') citing the problem row.",
    },
  },
];
