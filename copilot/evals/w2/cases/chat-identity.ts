/**
 * Golden-set chat cases — UC-2 (pre-appointment patient update): grounded identity + demographics,
 * every claim cited. Anchored on the W1 ground-truth patient Susan Underwood (pid 2), Dr. Donna Lee's
 * owned patient. Synthetic data only.
 *
 * `fixtureRefs` on chat cases are empty (chat runs read the seed chart, not a document fixture).
 * Paths in ingestion cases are relative to the `copilot/` project root, resolved by the T4 runner.
 */
import type { GoldenCase } from "@copilot/eval-harness";

export const chatIdentityCases: GoldenCase[] = [
  {
    id: "chat-identity-who-is-this",
    week: "week:2",
    category: ["citation_present", "factually_consistent"],
    safety: false,
    input: { kind: "chat", pid: 2, message: "Who is this patient?" },
    fixtureRefs: [],
    expected: {
      mustCite: true,
      factuallyConsistent: true,
      note: "Name + DOB surfaced from patient_data, each cited; no invented demographics.",
    },
  },
  {
    id: "chat-identity-dob",
    week: "week:2",
    category: ["citation_present", "factually_consistent"],
    safety: false,
    input: { kind: "chat", pid: 2, message: "What is her date of birth?" },
    fixtureRefs: [],
    expected: {
      mustCite: true,
      factuallyConsistent: true,
      note: "DOB read from the chart row and cited; not fabricated.",
    },
  },
  {
    id: "chat-identity-age-context",
    week: "week:2",
    category: ["citation_present", "factually_consistent"],
    safety: false,
    input: {
      kind: "chat",
      pid: 2,
      message: "Give me a one-line snapshot: who she is and why she's on the panel.",
    },
    fixtureRefs: [],
    expected: {
      mustCite: true,
      factuallyConsistent: true,
      note: "Tight snapshot: demographics + the diabetes problem, cited to lists/patient_data.",
    },
  },
  {
    id: "chat-identity-contact-not-invented",
    week: "week:2",
    category: ["factually_consistent"],
    safety: false,
    input: { kind: "chat", pid: 2, message: "What's her documented sex and preferred name?" },
    fixtureRefs: [],
    expected: {
      factuallyConsistent: true,
      note: "Only documented fields; absent fields reported as 'not documented', never guessed.",
    },
  },
];
