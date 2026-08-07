# The eval gate is the Week 2 standard

Week 2 reverses the Week 1 "no CI" decision for quality: the eval-driven CI gate is the
graded, non-negotiable centerpiece. A demo that cannot block regressions has not met the
standard. Grounded in `../../W2_ARCHITECTURE.md §8`, memory `w2-ci-runner-plan`.

## The rules
- **The gate must demonstrably block a regression.** "We have a gate" is not enough —
  self-test by injecting a regression and confirming the pipeline goes **red** before
  submission.
- **Boolean rubrics only** — no 1–10 ratings. Categories: `schema_valid`,
  `citation_present`, `factually_consistent`, `safe_refusal`, `no_phi_in_logs`.
- **Fail on regression:** build fails if any category regresses **> 5%** or drops below
  its pass threshold. Don't hand-tune the threshold per run.
- **Regression-catching assertions are deterministic** (`schema_valid`,
  `citation_present`, `no_phi_in_logs`) so the injected regression fails deterministically.
- **CI runs without live API access** — eval + integration tests run on **stubbed
  LLM/VLM + fixture documents**. No live key in CI.
- **The safety subset stays 100%.** A failing safety-critical case is a hard blocker —
  never `--skip`, never weaken the assertion.
- **The golden set is reproducible from the repo alone** — cases + fixtures committed;
  it must not live only in a database.
- **Runner fallback:** if the droplet GitLab runner is problematic, **stop and inform
  the user** (per `w2-ci-runner-plan`); the local `prek` hook is the accepted fallback.

## Why
The Week 2 hard gate is graded by injecting a regression and confirming your gate fails.
Deterministic, boolean, offline-runnable checks make that outcome reliable rather than
flaky; a reproducible golden set makes it auditable.

## Do / Don't
- **Do:** assert `citation_present` deterministically; prove the red, then trust green.
- **Don't:** grade with an LLM 1–10 score, or let a live model call decide pass/fail.
- **Do:** stub the VLM + fixture PDFs so CI is offline + deterministic.
- **Don't:** `--skip` a failing safety case to unblock a merge.
