---
name: w2-eval-ci-gate
description: Build or change the Week 2 eval-driven CI hard gate — the 50-case boolean-rubric golden set plus the PR-blocking pipeline (GitLab CI on the droplet runner + local prek hook) that fails on a >5% category regression. Use for the CI gate mechanics, boolean rubric wiring, the regression threshold, the stub/fixture design, or the hard-gate self-test.
---

# Skill: w2-eval-ci-gate

## When to use
Building or changing the Week 2 **eval-driven CI hard gate** — the graded centerpiece.
Covers the 50-case golden set, the five boolean rubric categories, the PR-blocking
pipeline, the regression threshold, the stub/fixture design, and the hard-gate
self-test. For authoring individual cases, use `add-eval-case`; for running suites,
`run-tests`. CI host decision + fallback: memory `w2-ci-runner-plan`. See
`W2_ARCHITECTURE.md` §8.

## The invariants
- **The gate must demonstrably block a regression.** The requirement is not "we have
  a gate" — during grading a regression is injected and the gate must go **red**.
- **Boolean rubrics only** — no 1–10 ratings (PDF pitfall). Categories (all required):
  `schema_valid`, `citation_present`, `factually_consistent`, `safe_refusal`,
  `no_phi_in_logs`.
- **Deterministic where it matters.** The regression-catching assertions
  (`schema_valid`, `citation_present`, `no_phi_in_logs`) are deterministic so the
  injected regression fails **deterministically**, not flakily.
- **CI-portable.** Eval + integration tests run **headless on stubbed LLM/VLM +
  fixture documents** — must pass in CI **without live API access** (PDF eng req).
- **Safety subset stays 100%** (`week:2` safety-tagged cases + the W1 set).

## Steps
1. **Grow the golden set to 50 cases** (`add-eval-case`, tagged `week:2`) across
   extraction, evidence retrieval, citations, refusals, missing-data. Synthetic only,
   **reproducible from the repo**.
2. **Wire the boolean rubrics** in the promptfoo config: each case asserts the
   relevant categories; the safety cases are `eval:safety`.
3. **Regression threshold:** the build **fails if any category regresses > 5% or
   drops below its pass threshold**. Encode the per-category baseline + comparison in
   the gate script.
4. **Stubs + fixtures:** store fixture PDFs/form images + stubbed VLM/LLM/Cohere
   responses so the full ingest→answer path runs in CI offline. This is where the
   effort is — design it so a live key is never needed in CI.
5. **CI pipeline (`.gitlab-ci.yml`):** lint, typecheck, unit tests, coverage, the
   50-case eval, **dependency audit**, **security scan**, supervisor↔worker contract
   test, extraction regression tests. Runs on the **droplet gitlab-runner**
   (`w2-ci-runner-plan`); keep concurrency low so CI doesn't starve the live demo.
   Secrets via masked CI/CD variables, never in config.
6. **Local prek hook:** extend the W1 prek setup with a pre-push hook running the
   eval + lint/typecheck/tests for fast feedback (routes through the container).
7. **Fallback (user instruction):** if the droplet runner is problematic, **STOP and
   inform the user**; likely fall back to the local prek hook as the authoritative
   gate (PDF accepts "Git Hook or equivalent"), keeping `.gitlab-ci.yml` committed.
8. **Self-test the hard gate:** before submission, inject a regression (e.g. drop a
   citation) and confirm the pipeline goes **red**; revert.

## Common pitfalls
- **A gate that can't fail is not a gate** — prove the red before trusting the green.
- **Don't require live API in CI** — stub the models; a flaky live call makes the
  regression detection unreliable and burns spend.
- **Don't weaken a safety assertion to get green** — a failing safety-critical case
  is a hard blocker, never `--skip`.
- **Don't hand-tune the 5% threshold per run** — set the baseline honestly and let
  the gate enforce it.
- **PHI in eval data/logs** fails `no_phi_in_logs` and the CI PHI-detection check —
  synthetic only.
