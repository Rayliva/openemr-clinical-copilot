import { describe, expect, it, vi } from "vitest";
import {
  checkGroundingWithRegeneration,
  type Claim,
  type GroundingFeedback,
  type GroundingJudge,
  type RegenerateClaims,
} from "../src/index.js";

const MEDS_ROW = "meds-uuid-1";
const PROB_ROW = "prob-uuid-1";
const RETRIEVED = [MEDS_ROW, PROB_ROW];

/** evidenceFor backed by a fixed map (rowUuid -> serialized content). */
function evidenceMap(entries: Record<string, string>): (ref: string) => string | null {
  return (ref) => entries[ref] ?? null;
}

const EVIDENCE = evidenceMap({
  [MEDS_ROW]: "Medication: Lisinopril 10mg, status active, source prescriptions",
  [PROB_ROW]: "Problem: Hypertension, status active",
});

/** Grounds only statements the cited evidence actually supports (mentions Lisinopril). */
const lisinoprilOnly: GroundingJudge = async ({ statement }) => ({
  grounded: statement.includes("Lisinopril"),
  reason: "cited evidence does not support that statement",
});

const alwaysGrounded: GroundingJudge = async () => ({ grounded: true });

describe("checkGroundingWithRegeneration (bounded regenerate-with-feedback)", () => {
  it("does not regenerate when the first attempt is fully grounded (AC-R1)", async () => {
    const regenerate = vi.fn<RegenerateClaims>(async () => []);
    const claims: Claim[] = [{ statement: "She is on Lisinopril.", sourceRefs: [MEDS_ROW] }];

    const result = await checkGroundingWithRegeneration(
      claims,
      RETRIEVED,
      EVIDENCE,
      alwaysGrounded,
      regenerate,
    );

    expect(result.ok).toBe(true);
    expect(result.retries).toBe(0);
    expect(result.groundedClaims).toHaveLength(1);
    expect(regenerate).not.toHaveBeenCalled();
  });

  it("regenerates with feedback and keeps the now-grounded claim (AC-R2)", async () => {
    const regenerate: RegenerateClaims = async () => [
      { statement: "She is on Lisinopril.", sourceRefs: [MEDS_ROW] },
    ];
    const claims: Claim[] = [{ statement: "She is on warfarin.", sourceRefs: [MEDS_ROW] }];

    const result = await checkGroundingWithRegeneration(
      claims,
      RETRIEVED,
      EVIDENCE,
      lisinoprilOnly,
      regenerate,
    );

    expect(result.ok).toBe(true);
    expect(result.retries).toBe(1);
    expect(result.groundedClaims.map((c) => c.statement)).toEqual(["She is on Lisinopril."]);
    expect(result.ungroundedClaims).toHaveLength(0);
    // The original over-claim never survives.
    expect(result.groundedClaims.some((c) => c.statement.includes("warfarin"))).toBe(false);
  });

  it("feeds the judge's per-claim reason back to regenerate (AC-R3)", async () => {
    const judge: GroundingJudge = async ({ statement }) => ({
      grounded: statement.includes("Lisinopril"),
      reason: "cited evidence does not support warfarin",
    });
    const regenerate = vi.fn<RegenerateClaims>(async () => [
      { statement: "She is on Lisinopril.", sourceRefs: [MEDS_ROW] },
    ]);
    const claims: Claim[] = [{ statement: "She is on warfarin.", sourceRefs: [MEDS_ROW] }];

    await checkGroundingWithRegeneration(claims, RETRIEVED, EVIDENCE, judge, regenerate);

    expect(regenerate).toHaveBeenCalledTimes(1);
    const feedback: readonly GroundingFeedback[] | undefined = regenerate.mock.calls[0]?.[0];
    expect(feedback).toEqual([
      { statement: "She is on warfarin.", reason: "cited evidence does not support warfarin" },
    ]);
  });

  it("re-gates regenerated claims through the citation check — no bypass (AC-R4)", async () => {
    // The retry cites a row that was never retrieved: L1 must drop it, so it can never
    // reach the answer even though the judge would have grounded it.
    const regenerate: RegenerateClaims = async () => [
      { statement: "She is on Lisinopril.", sourceRefs: ["unretrieved-row"] },
    ];
    const claims: Claim[] = [{ statement: "She is on warfarin.", sourceRefs: [MEDS_ROW] }];

    const result = await checkGroundingWithRegeneration(
      claims,
      RETRIEVED,
      EVIDENCE,
      lisinoprilOnly,
      regenerate,
    );

    expect(result.retries).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.groundedClaims).toHaveLength(0);
    expect(result.ungroundedClaims.map((u) => u.claim.statement)).toEqual(["She is on warfarin."]);
    // The regenerated, uncited claim is never surfaced.
    expect(result.groundedClaims.some((c) => c.statement.includes("Lisinopril"))).toBe(false);
  });

  it("degrades to the first attempt's partition when the retry does not fully ground (AC-R5)", async () => {
    const regenerate: RegenerateClaims = async () => [
      { statement: "She is on warfarin still.", sourceRefs: [MEDS_ROW] },
    ];
    const claims: Claim[] = [
      { statement: "She is on Lisinopril.", sourceRefs: [MEDS_ROW] }, // grounded first attempt
      { statement: "She is on warfarin.", sourceRefs: [MEDS_ROW] }, // dropped first attempt
    ];

    const result = await checkGroundingWithRegeneration(
      claims,
      RETRIEVED,
      EVIDENCE,
      lisinoprilOnly,
      regenerate,
      { maxRetries: 1 },
    );

    expect(result.retries).toBe(1);
    expect(result.ok).toBe(false);
    // First attempt's partition is preserved (never worse than pre-retry).
    expect(result.groundedClaims.map((c) => c.statement)).toEqual(["She is on Lisinopril."]);
    expect(result.ungroundedClaims.map((u) => u.claim.statement)).toEqual(["She is on warfarin."]);
  });

  it("degrades (never throws) when regenerate errors (AC-R6)", async () => {
    const regenerate: RegenerateClaims = async () => {
      throw new Error("generator 503");
    };
    const claims: Claim[] = [
      { statement: "She is on Lisinopril.", sourceRefs: [MEDS_ROW] },
      { statement: "She is on warfarin.", sourceRefs: [MEDS_ROW] },
    ];

    const result = await checkGroundingWithRegeneration(
      claims,
      RETRIEVED,
      EVIDENCE,
      lisinoprilOnly,
      regenerate,
    );

    expect(result.retries).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.groundedClaims.map((c) => c.statement)).toEqual(["She is on Lisinopril."]);
    expect(result.ungroundedClaims).toHaveLength(1);
  });

  it("does not regenerate when maxRetries is 0 (AC-R7)", async () => {
    const regenerate = vi.fn<RegenerateClaims>(async () => []);
    const claims: Claim[] = [{ statement: "She is on warfarin.", sourceRefs: [MEDS_ROW] }];

    const result = await checkGroundingWithRegeneration(
      claims,
      RETRIEVED,
      EVIDENCE,
      lisinoprilOnly,
      regenerate,
      { maxRetries: 0 },
    );

    expect(result.retries).toBe(0);
    expect(result.ok).toBe(false);
    expect(result.ungroundedClaims).toHaveLength(1);
    expect(regenerate).not.toHaveBeenCalled();
  });
});
