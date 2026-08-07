# Work manifest — eval-driven CI gate (Req 6 + CI evidence + integration tests)

> Chunk goal: turn the eval gate from **amber → green** and CI evidence from **red → green** by
> building the follow-on slices the `w2-eval-gate` spec defers to its Boundaries — the golden set,
> the boolean rubric scorers, offline stubs, the case runner, baseline persistence, CI wiring, and
> the injected-regression self-test. The **pure decision core is already done** (`@copilot/eval-gate`:
> `evaluateGate`, `scoreCategories`, `checkCoverage`, `validateBaseline`) and is a frozen read-only
> dependency for everything here.
>
> Governed by `.claude/rules/parallel-work-isolation.md` + `w2-eval-gate`. Serial stays the default;
> this manifest fans out only Wave 1 (three genuinely independent, file-disjoint tasks).

## Wave 0 — contracts & prerequisites (serial, orchestrator)

- **T0 freeze-contracts + package skeleton** — write/commit:
  `packages/eval-harness/package.json`, `packages/eval-harness/tsconfig.json`,
  `packages/eval-harness/vitest.config.ts`, `packages/eval-harness/src/contracts.ts`,
  `packages/eval-harness/src/index.ts` (barrel — orchestrator-owned for the whole chunk).
  - **Interfaces frozen (Zod-first):**
    - `GoldenCase` — `{ id, week: 'week:2', category: RubricCategory[], safety: boolean,
      kind: 'chat' | 'ingestion', input, fixtureRefs?, expected }` (the golden-set schema every case
      validates against; `RubricCategory` re-exported from `@copilot/eval-gate`).
    - `RubricScorer` — `(runOutput, goldenCase) => Partial<Record<RubricCategory, boolean>>`
      (a scorer reports only the categories it measures; absent ≠ false — matches `CaseResult`).
    - `StubEngine` — the deterministic offline LLM/VLM/OCR the runner injects in CI, satisfying the
      **existing** ports (`OcrPort`, the generate/VLM ports) so no runtime code changes. Reuses
      `apps/agent/src/graph/stubGenerate.ts` as the LLM-stub precedent.
  - Also: register `evals/w2/` as the golden-set home and note the baseline JSON path
    (`evals/w2/baseline.json`) so Wave-1 tasks agree on locations without owning them.

## Wave 1 — parallel (3 builders, file-disjoint)

- **T1 rubric scorers** — depends: [T0]
  - write scope: `packages/eval-harness/src/scorers/**`, `packages/eval-harness/test/scorers/**`
  - read scope: `packages/eval-harness/src/contracts.ts`, `packages/eval-gate/**` (frozen),
    `packages/verification/**` (read-only, to reuse the citation/grounding shapes, not to edit)
  - spec: `docs/specs/w2-eval-gate.md` (rubric categories) — acceptance: deterministic scorers for
    `schema_valid`, `citation_present`, `no_phi_in_logs` (regression-catchers — pure, no LLM); a
    boolean `safe_refusal` scorer; a boolean `factually_consistent` scorer that consumes an upstream
    boolean (never a 1–10 score). Each scorer unit-tested red→green; absent-category semantics honored.

- **T2 golden set (toward 50 cases)** — depends: [T0]
  - write scope: `evals/w2/cases/**`, `evals/w2/fixtures/**`
  - read scope: `packages/eval-harness/src/contracts.ts` (the `GoldenCase` schema), the existing
    `packages/ingestion/fixtures/w2/**` + `demo-documents/**` for realistic inputs, `../USERS.md`
  - spec: `docs/specs/w2-eval-gate.md` + `docs/specs/eval-suite.md` — acceptance: golden cases that
    each `GoldenCase.parse()` clean; a tagged **safety subset** (refusal / non-owned-pid / absence≠
    negative / contraindication); coverage across every rubric category and both `kind`s; a small
    validation test asserting the whole set parses + the safety subset is non-empty. **Data only —
    no runtime/scorer code.**

- **T3 offline stub engine** — depends: [T0]
  - write scope: `packages/eval-harness/src/stubs/**`, `packages/eval-harness/test/stubs/**`
  - read scope: `packages/eval-harness/src/contracts.ts` (`StubEngine`), the existing ports in
    `apps/agent/src/ocr/**` + `apps/agent/src/graph/stubGenerate.ts` + `packages/ingestion/**`
    (interfaces to satisfy, read-only)
  - spec: `w2-eval-gate` rule (offline, deterministic CI) — acceptance: a deterministic stub LLM +
    stub VLM/OCR keyed off fixture id (same input → same output, no clock/rand/IO), returning
    schema-valid outputs for the happy path and a togglable malformed/uncited output for the
    self-test. Unit-tested for determinism.

## Wave 2 — serial (orchestrator; integration point)

- **T4 case runner + baseline** — depends: [T1, T2, T3]
  - write scope: `packages/eval-harness/src/runner.ts`, `packages/eval-harness/test/runner.test.ts`,
    `evals/w2/baseline.json`, and the barrel `packages/eval-harness/src/index.ts`
  - read scope: all of Wave 1 + `packages/eval-gate/**`
  - why serial: this is the single integrator that wires golden set → stub engine → scorers →
    `evaluateGate`, plus the **runner guards** the spec's Open Questions mandate (min case-count per
    category; reject a corrupted/incomplete baseline). It reads every Wave-1 output and owns the
    shared barrel — never fanned out.
  - **Requirements surfaced by the Wave-1 code review (address in T4):**
    - **Define `refused` semantics + produce refusals deterministically offline.** The owned-pid
      *content*-refusal safety cases (`safety-injection-cross-patient`, `safety-ungrounded-dose-refusal`,
      `safety-out-of-scope-prescribe`, all pid 2, `mustRefuse:true`) have no refusal signal in the
      stub `generate()` (which always returns a grounded non-refusal). T4 must make `output.refused`
      emerge deterministically — by exercising the real authz/verification path offline (preferred:
      the refusal is a real mechanism, not hardcoded) or, failing that, a deterministic per-case
      signal — so the safety subset can reach 100% offline. The non-owned-pid case (pid 3) already
      refuses deterministically via authz.
    - **Absence≠negative regression power lives in `citation_present`/`no_phi_in_logs`, not
      `factually_consistent`** (which is a constant echo of the golden boolean and can't catch an
      agent that wrongly says "labs normal" on an empty chart). If T4 can add a deterministic
      absence check (e.g. assert the answer contains no "normal/clear/none" *positive* assertion when
      no rows were retrieved), do so; otherwise document that those safety cases are grounded by the
      deterministic categories.
    - **`schema_valid` chat branch is dead** until a chat response DTO is frozen and a chat golden
      case opts into `schema_valid`. Leave the local minimal schema; revisit if a chat DTO lands.

## Serial-only (never fanned out)

- **S1 CI wiring** — write scope: `.gitlab-ci.yml` (repo root) and/or the prek hook config —
  reason: **repo-root shared config, governed by the root CLAUDE.md**, outside `copilot/`; also the
  runner fallback decision (`w2-ci-runner-plan`) is a user gate. Built serially in the main tree.
- **S2 "prove the red" self-test** — write scope: `packages/eval-harness/test/regression-selftest.test.ts`
  — reason: this is the **validity proof of the gate itself** (inject a scorer regression via the
  stub's malformed toggle → assert `evaluateGate` returns `passed:false`). Safety-bearing meta-test;
  the orchestrator owns it, per `w2-eval-gate` ("prove the red, then trust green").

## Notes / honest caveats
- **Install cost:** T1 and T3 builders each need `pnpm install` in their worktree before vitest runs
  (minutes on Windows). T2 is mostly data + one tiny test. The three tasks are substantial and
  genuinely independent, so the fan-out pays off — but the whole chunk could also be built serially
  if you'd rather not pay the worktree overhead this first time.
- **No safety-spine, no PHP** in the parallel wave: scorers/stubs/cases are eval *infrastructure*,
  not the runtime verification gate (`packages/verification`, untouched) and not the PHP module.
- **Barrel discipline:** `packages/eval-harness/src/index.ts` is orchestrator-owned in Wave 0 and
  Wave 2; no Wave-1 builder writes it (they export from their own subdir files only).
