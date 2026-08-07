# Spec — Grounding judge (verification layer 2)

Status: **Built (opt-in), pending a paid live run.** Pure `checkGrounding` +
evidence-index projection + graph node + haiku-backed judge wired behind
`COPILOT_GROUNDING_JUDGE` (off by default). Unit-tested end-to-end with a fake judge
(6 module tests + 2 graph tests: over-claim dropped, supported claim kept, badge names
the omission). The real judge (`groundingJudge.ts`) is the injected LLM seam — like
`claudeGenerate.ts`, validated by a live run, not a unit test. AC8 (a live over-claim
eval) is deferred: forcing the real generator to over-claim is not deterministic; the
mechanism is proven by the unit tests, and a dedicated judge mini-eval is a follow-up.
Traces to `.claude/rules/verification-gate.md`,
`.claude/rules/provenance-and-grounding.md`, `ARCHITECTURE.md §2.5`, USERS.md
("one confident hallucination loses the user").

**Bounded regenerate-with-feedback (2026-07-10):** the retry step the
`verification-gate` rule prescribes ("bounded regenerate-with-feedback, then
'here's what I can confirm; I could not verify X.'") is now implemented — see the
section below. Previously an ungrounded claim was dropped outright with no attempt
to recover; now the judge's per-claim reasons are fed back to the generator for one
bounded regeneration before degrading. This is also the real source for the
`retries_total` metric, which the E4 dashboard shipped as a labeled zero
(`observability-dashboard.md` open questions).

## Problem

The citation gate (layer 1, `checkCitations`) proves a claim *cites a row that was
retrieved* — attribution. It does **not** prove the cited row *supports* the
statement — faithfulness. So a model can cite a real `lists` row for a problem but
misstate its status, or attach a plausible-but-unsupported sentence to a valid
uuid, and layer 1 passes it. That gap is why the badge sometimes says "could not
fully verify" opaquely: nothing checks entailment. This is the biggest remaining
reliability lever.

## Behavior

Insert **layer 2** between citation (layer 1) and the constraint engine (layer 3):
for each claim that passed layer 1, an LLM **grounding judge** decides whether the
claim's *cited evidence* entails the statement. Ungrounded claims are dropped from
the answer and reported; the response degrades gracefully rather than showing an
unverified sentence.

- **The judge sees only the cited evidence for that one claim** — never the whole
  snapshot (`verification-gate` rule). Input: `{ statement, evidence[] }` where
  `evidence` is the serialized content of exactly the rows the claim cites.
- **One claim at a time** (isolation; no cross-claim contamination). Output per
  claim: `{ grounded: boolean, reason? }`.
- **Deterministic-safe framing:** the judge is the *one* allowed LLM in the gate,
  and only ever *removes* content (an ungrounded claim is dropped). It can never
  *add* a clinical assertion. Safety-bearing constraint logic (layer 3) stays
  deterministic and runs on structured facts regardless of the judge.
- **Graceful degradation:** a judge error/timeout for a claim → that claim is
  treated as **ungrounded** (dropped), never silently kept. Bounded retry lives in
  the judge impl; the pure module never throws. If every claim drops → the standard
  degrade message; the surviving-claims answer is labeled with what could not be
  verified.
- **Model:** a cheaper/faster model than the generator (e.g. `claude-haiku-4-5`) —
  entailment is a narrow task, and this halves the cost impact of a second LLM call.

### Pipeline
`assembleContext → generate → verify(citation, L1) → grounding(L2) → constraints(L3) → respond`
- `assembleContext` additionally builds an **evidence index** `rowUuid → text` from
  the retrieved facts (short human-readable serialization per row).
- `grounding` runs `checkGrounding` over the **layer-1-verified** claims only.
- `respond` renders the **grounded** claims; appends a labeled "Could not verify:"
  section listing dropped statements (badge transparency), plus the layer-3 safety
  flags.

### Contracts (pure module `@copilot/verification`)
```
type GroundingJudge = (input: { statement: string; evidence: readonly string[] })
  => Promise<{ grounded: boolean; reason?: string }>;

checkGrounding(
  claims: readonly Claim[],
  evidenceFor: (ref: string) => string | null,
  judge: GroundingJudge,
): Promise<{ ok: boolean; groundedClaims: Claim[]; ungroundedClaims: {claim, reason}[] }>
```
Pure, LangGraph-free, judge injected (orchestrator-only rule). A fake judge drives
unit tests; the real haiku-backed judge is wired in the agent.

## Boundaries (what this does NOT do)
- Not a clinical-safety check — that is layer 3 (deterministic, structured facts).
- Not a fact *source*: the judge only accepts/rejects the model's own claims against
  their cited rows; it never introduces new facts.
- Does not see the whole snapshot, other claims' evidence, or model priors.
- Optional-when-unwired: if no judge is injected (tests, or a cost-off mode), layer 2
  is skipped and layer-1-verified claims pass through unchanged (documented; prod
  wires the judge).

## Acceptance criteria
- **AC1** A claim whose cited evidence supports it → kept (judge → grounded).
- **AC2** A claim whose cited evidence does not support it → dropped + reported
  (judge → not grounded), and never appears in the answer body.
- **AC3** A claim with no resolvable evidence → dropped (judge not called).
- **AC4** The judge receives **only** that claim's cited evidence (asserted).
- **AC5** A judge that throws → the claim is dropped with a reason; `checkGrounding`
  never throws.
- **AC6** `ok` is true iff no claim was dropped.
- **AC7** `respond` labels dropped claims ("Could not verify: …") — the badge is no
  longer opaque.
- **AC8** Eval: a case where the model over-claims beyond its cited row is caught
  (the over-claim is dropped); safety subset stays 100%.

## Bounded regenerate-with-feedback (layer-2 retry)

When the grounding judge drops one or more claims, do not degrade immediately.
Feed the judge's **per-claim `reason`** back to the generator, regenerate once
(bounded), re-gate the new claims through the **full** verification gate (L1
citation → L2 grounding), and keep the retry **only if it now fully grounds**.
Otherwise fall back to the first attempt's partition — exactly the current
drop-and-degrade behavior. This is the rule's "bounded regenerate-with-feedback,
then 'here's what I can confirm; I could not verify X.'"

### Where the logic lives (orchestrator-only)
A pure, LangGraph-free function `checkGroundingWithRegeneration` in
`@copilot/verification` owns the loop; it is injected a `regenerate` callback (the
model-role seam) and the same `judge` and `evidenceFor` as `checkGrounding`. The
graph `grounding` node stays a thin wrapper: it builds the `regenerate` closure over
`deps.generate` and records the returned retry count to the metrics registry.

### Contract (pure module)
```
type GroundingFeedback = { statement: string; reason: string };
type RegenerateClaims  = (feedback: readonly GroundingFeedback[])
  => Promise<readonly Claim[]>;   // returns RAW claims — the loop re-gates them

checkGroundingWithRegeneration(
  claims: readonly Claim[],              // L1-verified claims (first attempt)
  retrievedRefs: Iterable<string>,       // to re-run L1 on regenerated claims
  evidenceFor: (ref) => string | null,
  judge: GroundingJudge,
  regenerate: RegenerateClaims,
  options?: { maxRetries?: number },     // default 1
): Promise<GroundingVerdict & { retries: number }>
```

### Behavior
- **No bypass.** Regenerated claims are run through `checkCitations` (L1) *then*
  `checkGrounding` (L2) before they can be kept — a regenerated claim that cites an
  unretrieved row is dropped, never surfaced (`verification-gate` rule).
- **Keep-if-better, never worse.** The retry's verdict replaces the first only when
  it is fully grounded *and* non-empty. Any other outcome (partial, empty, or a
  `regenerate` that throws) degrades to the **first** attempt's grounded/ungrounded
  partition. The answer is therefore never worse than pre-retry.
- **Bounded.** At most `maxRetries` regenerations (default 1). `maxRetries: 0`
  reduces to plain `checkGrounding`.
- **Never throws.** A `regenerate` error breaks the loop and degrades; the count
  still reflects the attempt made.
- **Feedback = the judge's own reasons.** The callback receives
  `{ statement, reason }` for each claim the latest attempt could not ground, so the
  generator is told *why* — not merely "try again".
- **`feedback` on the generate seam.** `GenerateFn` gains an optional
  `feedback?: readonly GroundingFeedback[]`; the real Claude generator appends it to
  the prompt as a revise-and-tighten instruction. Omitted on the first (normal) call.

### Retries metric (closes the E4 gap)
`retries_total` was shipped at zero and labeled "no retry path implemented"
(`observability-dashboard.md`). This is its real source: the `grounding` node calls
`metrics.recordRetry({ operation: 'grounding', attempts })` with the loop's retry
count, and `retryPathImplemented` becomes `true`. A turn with no dropped claim, no
judge wired, or a first-attempt success records nothing (attempts = 0).

### Acceptance criteria
- **AC-R1** First attempt fully grounded → no regeneration; `retries === 0`; result
  matches plain `checkGrounding`.
- **AC-R2** First attempt drops a claim; `regenerate` (given the feedback) returns a
  claim the judge now grounds → verdict `ok`, the claim is kept, `retries === 1`, and
  the original over-claim never appears.
- **AC-R3** The `regenerate` callback receives the judge's per-claim `reason`(s) as
  feedback (asserted on the callback input).
- **AC-R4** A regenerated claim citing an unretrieved row is dropped by the L1
  re-check — it is not kept even though the loop produced it.
- **AC-R5** Bounded: with `maxRetries: 1`, at most one regeneration; if it still does
  not fully ground, the result is the **first** attempt's partition (grounded kept,
  ungrounded reported) with `retries === 1`.
- **AC-R6** `regenerate` throws → the loop degrades to the first attempt's partition,
  never throws, and `retries` reflects the attempt.
- **AC-R7** `maxRetries: 0` → identical to `checkGrounding`, `retries === 0`.
- **AC-R8** Graph + metrics: a turn where the judge drops a claim and regeneration
  fixes it renders the grounded claim, shows no "Could not verify" section, and
  increments `retriesTotal`; `retryPathImplemented` is `true`.

## Cost / open questions
- **Cost:** one extra LLM call per claim (haiku). Flag before any paid run; re-baseline
  `docs/cost-analysis.md` after wiring (the earlier estimate: grounding ≈ doubles
  per-turn LLM cost with a same-tier model — haiku cuts that materially).
- Batch-vs-per-claim: per-claim chosen for isolation; revisit if latency hurts.
- Judge prompt + its own mini-eval (does the judge itself over/under-reject?) — a
  follow-up once wired.
- **Retry salvage policy: keep-if-fully-grounded vs best-partial.** The loop keeps a
  retry only when it fully grounds, else falls back to the first attempt. A
  *best-partial* policy (keep whichever attempt grounds the most claims) could
  surface one extra confirmed claim in mixed cases, but risks mixing/contradicting
  claims across attempts and the empty-set trap (a retry that grounds nothing reading
  as `ok`). Deferred as conservative-by-default; revisit if the flagship UC wants
  maximum confirmed recall.
- **Retry cost.** Each regeneration is an extra generator call (sonnet-class) plus a
  re-judge (haiku) per surviving claim. Bounded at 1 by default; a failed grounding
  check is rare, so the expected added cost per turn is near zero. Re-baseline
  `docs/cost-analysis.md` if `maxRetries` is ever raised.
