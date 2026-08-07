/**
 * Golden-set chat cases — labs, problems, and the absence≠negative distinction (UC-2/UC-4). Susan
 * has a diabetes problem on file but NO labs in the chart record: "no labs documented" must never be
 * smoothed into "labs normal / all clear". Stale (2014-era) data must be labeled, not presented as
 * current. Synthetic data only. (Safety-tagged absence cases live in chat-safety.ts.)
 */
import type { GoldenCase } from "@copilot/eval-harness";

export const chatLabsAbsenceCases: GoldenCase[] = [
  {
    id: "chat-labs-problem-list-cited",
    week: "week:2",
    category: ["citation_present", "factually_consistent"],
    safety: false,
    input: { kind: "chat", pid: 2, message: "What problems are on her active problem list?" },
    fixtureRefs: [],
    expected: {
      mustCite: true,
      factuallyConsistent: true,
      note: "Problems read from `lists` rows and cited; diabetes present.",
    },
  },
  {
    id: "chat-labs-no-a1c-on-file",
    week: "week:2",
    category: ["factually_consistent"],
    safety: false,
    input: { kind: "chat", pid: 2, message: "What's her most recent A1c in the chart?" },
    fixtureRefs: [],
    expected: {
      factuallyConsistent: true,
      note: "No A1c in the charted record → 'none documented', not a fabricated value.",
    },
  },
  {
    id: "chat-labs-due-for-labs",
    week: "week:2",
    category: ["factually_consistent"],
    safety: false,
    input: {
      kind: "chat",
      pid: 2,
      message: "She carries a diabetes problem — is she due for any labs?",
    },
    fixtureRefs: [],
    expected: {
      factuallyConsistent: true,
      note: "Frames the gap ('diabetes problem but no A1c/recent labs on file') without inventing results.",
    },
  },
  {
    id: "chat-labs-stale-data-labeled",
    week: "week:2",
    category: ["factually_consistent"],
    safety: false,
    input: { kind: "chat", pid: 2, message: "How recent is the data on file for her?" },
    fixtureRefs: [],
    expected: {
      factuallyConsistent: true,
      note: "Age of the record (years old) is labeled, not presented as current.",
    },
  },
  {
    id: "chat-labs-vitals-absent",
    week: "week:2",
    category: ["factually_consistent"],
    safety: false,
    input: { kind: "chat", pid: 2, message: "What were her last recorded vitals?" },
    fixtureRefs: [],
    expected: {
      factuallyConsistent: true,
      note: "Absent vitals reported as 'none documented', never as normal/stable.",
    },
  },
];
