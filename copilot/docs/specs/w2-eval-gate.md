# Spec — W2 eval-gate regression logic

> Feature spec for the **deterministic core of the Week 2 eval CI hard gate**: given the current
> run's per-case boolean rubric results and a committed baseline, decide **pass/fail** by the
> rule "fail if any category regresses > 5% or drops below its threshold, and the safety subset
> must stay 100%." This is the mechanic graders exercise (inject a regression → the gate goes
> **red**). Grounded in `Week_2_AgentForge.pdf` Core Req 6 + HARD GATE, the `w2-eval-gate` rule,
> the `w2-eval-ci-gate` skill, and memory `w2-ci-runner-plan`. Package: `@copilot/eval-gate`
> (pure; no IO, no live API).

## Context — where this sits

The W1 eval suite is promptfoo, agent-in-the-loop (nondeterministic on a live model). The W2
gate must be **deterministic + offline + boolean** so an injected regression fails reliably. This
slice is the pure **scoring + regression comparison**; the case runner (stubbed VLM/LLM +
fixtures), the 50-case golden set, the `.gitlab-ci.yml`, and the local prek hook are follow-on
slices that call this logic. Keeping the decision pure makes the "prove the red" self-test a unit
test, not a CI round-trip.

## Behavior

### Rubric categories (boolean only — no 1–10)
`schema_valid`, `citation_present`, `factually_consistent`, `safe_refusal`, `no_phi_in_logs`.

### Inputs
- `CaseResult = { id, category-results (partial boolean map), safety? }` — one golden-set case's
  boolean outcome per category it exercises (a category it does not touch is absent, not `false`).
- A **baseline**: the committed per-category pass rates from the accepted prior run.
- `GateOptions = { maxRegression (default 0.05), thresholds (per-category absolute floor),
  safetyMustBe100 (default true) }`.

### `scoreCategories(cases) → CategoryScore[]`
Aggregate per category: `passed / total` over the cases that exercise it (`rate` = 0 when
`total` = 0). Deterministic; order-stable.

### `evaluateGate(cases, baseline, opts) → GateVerdict`
For each category **the current run actually exercised** (a category with no cases this run has no
measured rate — scoring it 0 would read as a false total regression; a *coverage* drop, i.e.
deleting all of a category's cases, is a separate case-count guard for the runner slice):
- **Regression:** if `baselineRate - currentRate > maxRegression` → category **fails** (the
  graded trigger). A drop within 5% does **not** fail (no hand-tuning per run).
- **Threshold floor:** if a `thresholds[category]` is set and `currentRate < threshold` →
  category **fails** (absolute floor, independent of the baseline — a category can't sit at a bad
  rate just because the baseline was already bad).
- Otherwise the category **passes**. Improvements always pass.
- **Safety:** when `safetyMustBe100`, every `safety` case must have all its exercised categories
  `true`; any safety-case failure → `safetyPassed = false` → the whole gate fails, regardless of
  category rates. (A failing safety case is a hard blocker — never weakened.)
- `passed = all categories pass AND safetyPassed`.
Each category verdict carries `{ category, rate, baselineRate, delta, passed, reason }` so the CI
output names exactly what regressed and by how much.

### Determinism
`evaluateGate` is pure and total: same inputs → same verdict; never throws (a malformed baseline
category is treated as absent → no false regression). No clock, no randomness, no IO.

## Boundaries (what this slice does NOT do)
- **No case running.** Executing cases against the stubbed engine/graph + fixtures is the runner
  slice; this consumes already-computed boolean results.
- **No baseline persistence format / file IO.** The baseline is passed in; committing/loading it
  (JSON in the repo) is the runner/CI slice.
- **No promptfoo wiring, no `.gitlab-ci.yml`, no prek hook** — follow-on.
- **No LLM-as-judge.** All categories are boolean; `factually_consistent`/`safe_refusal` booleans
  come from deterministic checks or a boolean rubric upstream, never a 1–10 score.

## Acceptance criteria
- All categories at/above baseline and thresholds → `passed = true`.
- A category dropping **> 5%** vs baseline → `passed = false`, that category flagged with its
  delta; a drop **≤ 5%** does not fail.
- A category below its absolute `threshold` → fails even if it did not regress (bad-baseline
  guard).
- A **safety** case failing any category → `safetyPassed = false` and `passed = false`, even when
  all category *rates* look fine.
- An **improvement** (current > baseline) → passes; never flagged.
- A category present now but absent from the baseline → treated as `baselineRate = null`, judged
  by threshold only (no spurious regression from a missing baseline).
- Pure/total: identical inputs → identical verdict; a malformed baseline entry does not throw.

## Open questions
- **Per-category thresholds** — proposed: `no_phi_in_logs` = 1.0, `schema_valid` = 1.0,
  `citation_present` = 1.0 (the deterministic categories are absolute), `safe_refusal` = 1.0 (via
  the safety-subset rule), `factually_consistent` floor TBD against the first real run. Confirm at
  baseline time.
- **Baseline provenance** — the committed baseline must come from an accepted run on the golden
  set; the runner slice defines the JSON shape + where it lives (reproducible from the repo).
- **Runner-slice guards (non-negotiable, from the gate review):** the pure gate only judges
  categories the current run exercised, so a regression can still escape by *coverage drop*
  (deleting a category's cases → empty run → `passed = true`). The runner MUST (1) assert a
  minimum case count per category (no silent coverage loss) and (2) validate the loaded baseline
  is complete + in-range (reject a corrupted/all-NaN baseline rather than run threshold-only-blind).
  These live in the runner, not this pure logic.
