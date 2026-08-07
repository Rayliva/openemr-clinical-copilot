/**
 * Verification layer 2 — semantic grounding judge.
 *
 * Guarantees *faithfulness*: a claim that passed the citation check (layer 1) is
 * kept only if its *cited evidence* actually supports the statement. The judge is
 * the one LLM allowed inside the gate, and it can only ever *remove* a claim — it
 * never introduces a fact (`verification-gate` rule). Clinical-safety logic stays
 * deterministic in layer 3.
 *
 * Pure and LangGraph-free: the judge is injected, so this is unit-testable with a
 * fake and swappable at the model-role boundary (orchestrator-only rule).
 */

import { checkCitations, type Claim } from "./citations.js";

export interface GroundingJudgeInput {
  readonly statement: string;
  /** Serialized content of exactly the rows this claim cites — never the snapshot. */
  readonly evidence: readonly string[];
}

export interface GroundingJudgeResult {
  readonly grounded: boolean;
  readonly reason?: string;
}

/** The injected entailment judge (a cheap LLM in prod; a fake in tests). */
export type GroundingJudge = (input: GroundingJudgeInput) => Promise<GroundingJudgeResult>;

export interface UngroundedClaim {
  readonly claim: Claim;
  readonly reason: string;
}

/** Tuning for {@link checkGrounding}. */
export interface GroundingOptions {
  /**
   * Max judge calls in flight at once. Each call is independent, so this only
   * compresses wall-clock — it never changes the verdict. Default 5; a conservative
   * pool that captures nearly all the win without bursting the LLM's rate limit
   * under concurrent sessions. Values below 1 are clamped to 1 (serial).
   */
  readonly concurrency?: number;
}

const DEFAULT_CONCURRENCY = 5;

/**
 * Map `items` through `worker` with at most `limit` concurrent invocations,
 * returning results in input order. `worker` is expected not to throw (callers
 * wrap their own failures); a rejection here propagates, so the pool is only used
 * with a worker that resolves for every item.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runnerCount = Math.min(Math.max(1, limit), items.length);
  const runners = Array.from({ length: runnerCount }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await worker(items[index] as T);
    }
  });
  await Promise.all(runners);
  return results;
}

/** Per-claim decision, index-aligned so the verdict can be reduced in input order. */
type ClaimDecision =
  | { readonly kind: "grounded"; readonly claim: Claim }
  | { readonly kind: "ungrounded"; readonly claim: Claim; readonly reason: string };

export interface GroundingVerdict {
  /** True iff no claim was dropped. */
  readonly ok: boolean;
  readonly groundedClaims: readonly Claim[];
  readonly ungroundedClaims: readonly UngroundedClaim[];
}

/**
 * Judge each claim against the content of exactly the rows it cites. A claim is kept
 * only when the judge returns `grounded: true`. Any failure mode — no resolvable
 * evidence, a not-grounded verdict, or a judge that throws — drops the claim and
 * records a reason. Never throws: a judge outage degrades to "unverified," which the
 * caller surfaces honestly rather than crashing or silently keeping the claim.
 */
export async function checkGrounding(
  claims: readonly Claim[],
  evidenceFor: (ref: string) => string | null,
  judge: GroundingJudge,
  options: GroundingOptions = {},
): Promise<GroundingVerdict> {
  // Each claim is judged against only its own cited rows, with no shared state, so
  // judging concurrently is verdict-identical to a serial loop — it only compresses
  // the stage from sum-of-per-claim to slowest-claim (within `concurrency`).
  const decideClaim = async (claim: Claim): Promise<ClaimDecision> => {
    const evidence = claim.sourceRefs
      .map((ref) => evidenceFor(ref))
      .filter((text): text is string => text !== null && text.length > 0);

    if (evidence.length === 0) {
      return { kind: "ungrounded", claim, reason: "no resolvable evidence for the cited sources" };
    }

    let result: GroundingJudgeResult;
    try {
      result = await judge({ statement: claim.statement, evidence });
    } catch {
      // Degrade, never keep an unverified claim (verification-gate rule).
      return { kind: "ungrounded", claim, reason: "grounding check unavailable" };
    }

    if (result.grounded) {
      return { kind: "grounded", claim };
    }
    return {
      kind: "ungrounded",
      claim,
      reason: result.reason ?? "cited evidence does not support the statement",
    };
  };

  const decisions = await mapWithConcurrency(
    claims,
    options.concurrency ?? DEFAULT_CONCURRENCY,
    decideClaim,
  );

  // Reduce in input order so the partition is byte-identical to the serial version.
  const groundedClaims: Claim[] = [];
  const ungroundedClaims: UngroundedClaim[] = [];
  for (const decision of decisions) {
    if (decision.kind === "grounded") {
      groundedClaims.push(decision.claim);
    } else {
      ungroundedClaims.push({ claim: decision.claim, reason: decision.reason });
    }
  }

  return { ok: ungroundedClaims.length === 0, groundedClaims, ungroundedClaims };
}

/** One ungrounded claim's statement + the judge's reason, fed back to regeneration. */
export interface GroundingFeedback {
  readonly statement: string;
  readonly reason: string;
}

/**
 * Re-run generation given the judge's feedback about which prior claims could not be
 * grounded. Returns **raw** claims — the loop re-gates them through the citation check
 * (L1) and the grounding judge (L2) before any can be kept, so this callback cannot
 * bypass the gate.
 */
export type RegenerateClaims = (
  feedback: readonly GroundingFeedback[],
) => Promise<readonly Claim[]>;

export interface GroundingLoopVerdict extends GroundingVerdict {
  /** How many times generation was re-run with feedback (0 = the first attempt sufficed). */
  readonly retries: number;
}

export interface RegenerateOptions {
  /** Max regenerations after a failed first grounding check. Default 1 (bounded). */
  readonly maxRetries?: number;
  /** Bounded concurrency for the inner grounding checks. See {@link GroundingOptions}. */
  readonly concurrency?: number;
}

function toFeedback(verdict: GroundingVerdict): GroundingFeedback[] {
  return verdict.ungroundedClaims.map((u) => ({
    statement: u.claim.statement,
    reason: u.reason,
  }));
}

/**
 * Bounded regenerate-with-feedback around the grounding judge — the recovery step
 * `verification-gate.md` prescribes ("bounded regenerate-with-feedback, then 'here's
 * what I can confirm; I could not verify X.'").
 *
 * Runs the grounding check; while a claim is ungrounded and retries remain, it feeds
 * the judge's per-claim reasons back to `regenerate`, re-gates the returned claims
 * through the citation check (L1) *then* the grounding judge (L2), and keeps the retry
 * **only when it fully grounds and is non-empty**. Any other outcome — a partial
 * retry, an empty one, or a `regenerate` that throws — degrades to the *first*
 * attempt's grounded/ungrounded partition, so the answer is never worse than pre-retry
 * and nothing bypasses the gate. Never throws.
 */
export async function checkGroundingWithRegeneration(
  claims: readonly Claim[],
  retrievedRefs: Iterable<string>,
  evidenceFor: (ref: string) => string | null,
  judge: GroundingJudge,
  regenerate: RegenerateClaims,
  options: RegenerateOptions = {},
): Promise<GroundingLoopVerdict> {
  const maxRetries = options.maxRetries ?? 1;
  const groundingOptions: GroundingOptions =
    options.concurrency === undefined ? {} : { concurrency: options.concurrency };
  // Snapshot the retrieved refs once: L1 re-checks must scope regenerated claims to
  // exactly the rows retrieved this turn (`authorization-and-pid-scope`).
  const available = [...retrievedRefs];

  const first = await checkGrounding(claims, evidenceFor, judge, groundingOptions);
  if (first.ok || maxRetries <= 0) {
    return { ...first, retries: 0 };
  }

  let latest = first;
  let retries = 0;
  while (retries < maxRetries) {
    retries += 1;
    let regenerated: readonly Claim[];
    try {
      regenerated = await regenerate(toFeedback(latest));
    } catch {
      // A generator outage ends the loop; degrade to the first attempt's partition.
      break;
    }
    // No bypass: regenerated claims pass L1 (citation) before L2 (grounding).
    const reverified = checkCitations(regenerated, available).verifiedClaims;
    const attempt = await checkGrounding(reverified, evidenceFor, judge, groundingOptions);
    if (attempt.ok && attempt.groundedClaims.length > 0) {
      return { ...attempt, retries };
    }
    latest = attempt;
  }

  // Retries exhausted or unhelpful: surface what the first attempt could confirm and
  // report what it could not (graceful degradation).
  return { ...first, retries };
}
