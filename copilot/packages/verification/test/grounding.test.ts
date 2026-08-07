import { describe, expect, it, vi } from "vitest";
import { checkGrounding, type Claim, type GroundingJudge } from "../src/index.js";

const MEDS_ROW = "meds-uuid-1";
const PROB_ROW = "prob-uuid-1";

/** evidenceFor backed by a fixed map (rowUuid -> serialized content). */
function evidenceMap(entries: Record<string, string>): (ref: string) => string | null {
  return (ref) => entries[ref] ?? null;
}

const EVIDENCE = evidenceMap({
  [MEDS_ROW]: "Medication: Lisinopril 10mg, status active, source prescriptions",
  [PROB_ROW]: "Problem: Hypertension, status active",
});

const grounded: GroundingJudge = async () => ({ grounded: true });
const reject: GroundingJudge = async () => ({ grounded: false, reason: "evidence does not support it" });

describe("checkGrounding (verification layer 2)", () => {
  it("keeps a claim whose cited evidence supports it (AC1)", async () => {
    const claims: Claim[] = [{ statement: "She is on Lisinopril.", sourceRefs: [MEDS_ROW] }];
    const verdict = await checkGrounding(claims, EVIDENCE, grounded);

    expect(verdict.ok).toBe(true);
    expect(verdict.groundedClaims).toHaveLength(1);
    expect(verdict.ungroundedClaims).toHaveLength(0);
  });

  it("drops and reports a claim the evidence does not support (AC2, AC6)", async () => {
    const claims: Claim[] = [{ statement: "She is on warfarin.", sourceRefs: [MEDS_ROW] }];
    const verdict = await checkGrounding(claims, EVIDENCE, reject);

    expect(verdict.ok).toBe(false);
    expect(verdict.groundedClaims).toHaveLength(0);
    expect(verdict.ungroundedClaims).toHaveLength(1);
    expect(verdict.ungroundedClaims[0]?.reason).toContain("does not support");
  });

  it("drops a claim with no resolvable evidence without calling the judge (AC3)", async () => {
    const judge = vi.fn(grounded);
    const claims: Claim[] = [{ statement: "Unfounded.", sourceRefs: ["missing-uuid"] }];
    const verdict = await checkGrounding(claims, EVIDENCE, judge);

    expect(judge).not.toHaveBeenCalled();
    expect(verdict.ok).toBe(false);
    expect(verdict.ungroundedClaims).toHaveLength(1);
  });

  it("passes the judge only that claim's cited evidence (AC4)", async () => {
    const judge = vi.fn<GroundingJudge>(async () => ({ grounded: true }));
    const claims: Claim[] = [{ statement: "Hypertension is documented.", sourceRefs: [PROB_ROW] }];
    await checkGrounding(claims, EVIDENCE, judge);

    expect(judge).toHaveBeenCalledTimes(1);
    const input = judge.mock.calls[0]?.[0];
    expect(input?.statement).toBe("Hypertension is documented.");
    expect(input?.evidence).toEqual(["Problem: Hypertension, status active"]);
    // Never leaks the meds row (not cited by this claim).
    expect(input?.evidence.join(" ")).not.toContain("Lisinopril");
  });

  it("drops a claim (never throws) when the judge errors (AC5)", async () => {
    const judge: GroundingJudge = async () => {
      throw new Error("judge upstream 503");
    };
    const claims: Claim[] = [{ statement: "She is on Lisinopril.", sourceRefs: [MEDS_ROW] }];
    const verdict = await checkGrounding(claims, EVIDENCE, judge);

    expect(verdict.ok).toBe(false);
    expect(verdict.ungroundedClaims).toHaveLength(1);
    expect(verdict.ungroundedClaims[0]?.reason.length).toBeGreaterThan(0);
  });

  it("partitions a mix of grounded and ungrounded claims", async () => {
    const judge: GroundingJudge = async ({ statement }) => ({
      grounded: statement.includes("Lisinopril"),
      reason: "off-evidence",
    });
    const claims: Claim[] = [
      { statement: "She is on Lisinopril.", sourceRefs: [MEDS_ROW] },
      { statement: "She is on warfarin.", sourceRefs: [MEDS_ROW] },
    ];
    const verdict = await checkGrounding(claims, EVIDENCE, judge);

    expect(verdict.groundedClaims).toHaveLength(1);
    expect(verdict.ungroundedClaims).toHaveLength(1);
    expect(verdict.groundedClaims[0]?.statement).toContain("Lisinopril");
  });
});

/** Resolve after `ms` real milliseconds — used to sequence out-of-order judge completion. */
const tick = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A judge that blocks every call on a shared release, recording how many calls are
 * in flight at once. `reached` resolves when `target` calls are simultaneously
 * blocked — so a serial implementation (only ever 1 in flight) never trips a
 * `target > 1` barrier, which is exactly what distinguishes parallel from serial.
 */
function barrierJudge(target: number): {
  judge: GroundingJudge;
  reached: Promise<void>;
  releaseAll: () => void;
  readonly maxInFlight: number;
} {
  let inFlight = 0;
  let maxInFlight = 0;
  let releaseAll!: () => void;
  const released = new Promise<void>((resolve) => {
    releaseAll = resolve;
  });
  let reachedResolve!: () => void;
  const reached = new Promise<void>((resolve) => {
    reachedResolve = resolve;
  });
  const judge: GroundingJudge = async () => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    if (inFlight >= target) {
      reachedResolve();
    }
    await released;
    inFlight -= 1;
    return { grounded: true };
  };
  return {
    judge,
    reached,
    releaseAll,
    get maxInFlight() {
      return maxInFlight;
    },
  };
}

const THREE_MEDS_CLAIMS: Claim[] = [
  { statement: "She is on Lisinopril.", sourceRefs: [MEDS_ROW] },
  { statement: "She has hypertension.", sourceRefs: [PROB_ROW] },
  { statement: "Lisinopril is active.", sourceRefs: [MEDS_ROW] },
];

describe("checkGrounding — parallelism (grounding-parallel spec)", () => {
  it("judges claims concurrently up to the limit (AC-P1)", async () => {
    const probe = barrierJudge(3);
    const pending = checkGrounding(THREE_MEDS_CLAIMS, EVIDENCE, probe.judge, {
      concurrency: 5,
    });

    // Serial (1 in flight) can never trip a target-3 barrier → resolves as "timeout".
    const outcome = await Promise.race([
      probe.reached.then(() => "reached" as const),
      tick(100).then(() => "timeout" as const),
    ]);
    expect(outcome).toBe("reached");
    expect(probe.maxInFlight).toBe(3);

    probe.releaseAll();
    const verdict = await pending;
    expect(verdict.groundedClaims).toHaveLength(3);
  });

  it("never exceeds the concurrency limit (AC-P1)", async () => {
    const probe = barrierJudge(2);
    const pending = checkGrounding(THREE_MEDS_CLAIMS, EVIDENCE, probe.judge, {
      concurrency: 2,
    });

    await probe.reached; // two are in flight
    await tick(30); // give a would-be third the chance to (wrongly) start
    expect(probe.maxInFlight).toBe(2);

    probe.releaseAll();
    await pending;
  });

  it("clamps a concurrency below 1 to serial (AC-P7)", async () => {
    const probe = barrierJudge(1);
    const pending = checkGrounding(THREE_MEDS_CLAIMS, EVIDENCE, probe.judge, {
      concurrency: 0,
    });

    await probe.reached; // one in flight
    await tick(30);
    expect(probe.maxInFlight).toBe(1);

    probe.releaseAll();
    await pending;
  });

  it("preserves original claim order regardless of completion order (AC-P5)", async () => {
    // The first claim's judge resolves last; order must still follow input order.
    const judge: GroundingJudge = async ({ statement }) => {
      if (statement.includes("Lisinopril.")) {
        await tick(40);
      }
      return { grounded: true };
    };
    const verdict = await checkGrounding(THREE_MEDS_CLAIMS, EVIDENCE, judge, {
      concurrency: 5,
    });

    expect(verdict.groundedClaims.map((c) => c.statement)).toEqual([
      "She is on Lisinopril.",
      "She has hypertension.",
      "Lisinopril is active.",
    ]);
  });
});
