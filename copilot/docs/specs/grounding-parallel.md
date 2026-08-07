# Spec: parallelize the grounding judge

## Context

Verification layer 2 (`packages/verification/src/grounding.ts`) runs the semantic
grounding judge — the one LLM allowed inside the gate — over each atomic claim.
Today `checkGrounding` judges claims **serially**: a `for` loop with `await
judge(...)` inside, so a response with N claims costs N sequential LLM
round-trips. Each judge call is independent (it sees only that claim's statement
and its cited evidence — no shared state, no ordering dependency), so the serial
loop wastes wall-clock for no correctness benefit.

This is the lowest-risk real-latency lever: it removes no safety guarantee and,
by construction, produces the **identical verdict** — it only compresses the
stage from *sum of per-claim latencies* to *slowest single claim* (within a
concurrency bound).

## Behavior

`checkGrounding(claims, evidenceFor, judge, options?)`:

- Judges the claims **concurrently**, with a bounded concurrency limit
  (default 5, overridable via `options.concurrency`).
- Produces a verdict **byte-identical** to the previous serial implementation for
  the same inputs: same `ok`, same `groundedClaims` and `ungroundedClaims`
  membership, **in original claim order**, with the same reason strings.
- Preserves every existing per-claim rule:
  - A claim with **no resolvable evidence** is dropped **without calling the
    judge**.
  - A judge that **throws** drops only that claim (reason "grounding check
    unavailable") and never affects sibling claims or the batch.
  - A `grounded: false` verdict drops the claim with its reason (or the default).
- **Never throws.** A judge outage degrades to "unverified" per-claim, as before.

`checkGroundingWithRegeneration` inherits the parallelism (it calls
`checkGrounding` internally). Its retry loop stays **serial** — each retry
depends on the prior verdict's feedback, so that ordering is inherent and
unchanged. `RegenerateOptions` gains an optional `concurrency` threaded to the
inner grounding checks.

## Boundaries (what this does NOT do)

- Does **not** change which claims are judged (that is the separate *conditional*
  lever — skipping the judge for templated projections — and is out of scope
  here).
- Does **not** change the judge's contract, its inputs, or the evidence scoping
  (still exactly the cited rows, never the snapshot).
- Does **not** parallelize the regeneration loop.
- Does **not** introduce a third-party dependency — the concurrency mapper is a
  small local pure function.

## Acceptance criteria

- **AC-P1 (bounded concurrency):** given N > 1 claims and a judge that blocks
  until released, the number of judge calls in flight at once is > 1 and never
  exceeds `concurrency`.
- **AC-P2 (identical verdict):** for any inputs, the partition (membership +
  original-claim order + reason strings + `ok`) equals the serial reference.
- **AC-P3 (no-evidence still skips the judge):** a claim whose cited refs resolve
  to nothing never invokes the judge.
- **AC-P4 (per-claim error isolation):** with a judge that throws for one claim
  and succeeds for others, only the throwing claim is dropped; the rest are
  judged and partitioned normally.
- **AC-P5 (order independent of completion):** when judges resolve out of order
  (e.g. later claims finish first), the output partitions still follow original
  claim order.
- **AC-P6 (never throws):** no combination of judge outcomes causes
  `checkGrounding` to reject.
- **AC-P7 (default + override):** default concurrency is used when no option is
  passed; `options.concurrency` overrides it; a value < 1 is clamped to 1.

## Open questions

- Default concurrency value: 5 chosen as a conservative pool that captures nearly
  all the win without bursting Anthropic rate limits under concurrent users.
  Revisit if the load test shows headroom or throttling.
