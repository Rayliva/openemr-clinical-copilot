---
name: run-tests
description: Run or watch the test suite for this pnpm workspace — Vitest (unit/integration), promptfoo (evals), and the 100%-safety-critical eval gate. Use after any red/green TDD step, before claiming a change is done, or to check the eval gate.
---

# Skill: run-tests

## When to use
Any time you need to run or watch the test suite — after a red/green TDD step,
before proposing a change is done, or to check the eval gate. Covers both Vitest
(unit/integration) and promptfoo (evals).

## Steps (this stack: pnpm workspace under `copilot/`)

Run from the `copilot/` root unless noted.

- **All unit/integration tests (Vitest):**
  `pnpm test`
- **A single package:**
  `pnpm --filter @copilot/verification test`  (swap the package name)
- **Watch mode while TDD-ing:**
  `pnpm --filter @copilot/tools test --watch`
- **A single file / test name:**
  `pnpm test -- path/to/file.test.ts -t "reconciles conflicting meds"`
- **Evals (promptfoo, needs seed data loaded + agent reachable):**
  `pnpm eval`  → runs `promptfoo eval -c evals/promptfooconfig.yaml`
- **Safety-critical eval subset (must be 100% green):**
  `pnpm eval:safety`  (tagged cases: authz-refusal, injection-refusal,
  constraint-flag, absence-not-clear)

> TODO: exact script names (`test`, `eval`, `eval:safety`) are set when the
> workspace is scaffolded — confirm against `copilot/package.json` before relying
> on them.

## Common pitfalls
- **Evals need real dependencies.** promptfoo drives the running agent → make sure
  the Compose stack (Redis, OpenEMR API, Langfuse) is up and the **seed data is
  loaded** (`seed-data` skill) or grounded cases fail for the wrong reason.
- **Mock at the boundary, not internals** (per `test-driven-development.md`). If a
  unit test needs the network, it's testing the wrong seam.
- **A green suite with the safety subset skipped is not green.** The
  safety-critical cases gate the milestone; never `--skip` them to get a pass.
- Don't run Vitest against a subset when a change spans packages — run the whole
  suite so cross-package type inference and contracts are exercised.
