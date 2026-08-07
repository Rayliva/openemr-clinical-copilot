# Build loop — Spec-first TDD

> **⚠️ Week 2 is active — follow [`w2-build-loop.md`](w2-build-loop.md), not this file.**
> `/build` reads this file by default, but the current phase is Week 2 (Multimodal
> Evidence Agent). Its loop, checkpoints, hard CI gate, and requirements board live in
> `w2-build-loop.md` and `week2-requirements.html`. Use **this** file only when working
> the Week 1 baseline. The two loops share the same spec-first TDD choice; Week 2 adds
> the PR-blocking eval gate. When the active phase changes, update this banner.

The build procedure for the Clinical Co-Pilot. Chosen because
`test-driven-development.md` and `spec-driven-development.md` are mandatory rules,
the success metrics are concrete numbers, and the architecture (verification gate +
promptfoo evals as ground truth) is built around testable behavior. Run it via
`/build`.

Re-run `/pick-loop` any time to switch strategies. This loop is not permanent.

---

## Inputs (read before each work session)
- `docs/PRD.md` — scope, priorities (P0/P1), success metrics, milestones.
- `docs/tech-spec.md` — the locked stack and constraints.
- `../AUDIT.md`, `../USERS.md`, `../ARCHITECTURE.md` — source of truth; they win.
- Everything in `.claude/rules/` — constraints on every change.
- `.claude/skills/INDEX.md` — the how-to for this stack.

## The unit of work: one **spec item**
A spec item is the smallest observable behavior that traces to a use case
(`UC-1…UC-4`) or an explicit success metric. Work items are pulled in **priority
order** from the PRD (P0 before P1), respecting the milestone sequence:
- **MVP (Fri 2026-07-10):** seed script; OpenEMR fork deployed; agent skeleton
  (`/health`, `/ready`); OAuth2 client registered.
- **Early (Sat 2026-07-11):** UC-1 + UC-2; verification layers 1–2; Langfuse +
  correlation IDs; first eval cases.
- **Final (Sun 2026-07-12):** UC-3 + UC-4; constraint engine; full eval suite; load
  tests + baselines; alerts; cost analysis; API collection; demo.

---

## The loop body (one iteration)

Repeat until the stopping condition holds.

1. **SELECT.** Pick the highest-priority unfinished spec item for the current
   milestone. State it in one line and the UC / metric it traces to. If it doesn't
   trace to one, don't build it (yet).

2. **SPEC.** If a written spec for it doesn't exist, write/extend one at
   `docs/specs/<feature>.md` (behavior, boundaries, acceptance criteria, open
   questions) per `spec-driven-development.md`. For a bug, the bug report is the
   spec — reference it. **If a spec ambiguity is a real product decision, stop and
   ask the user** (don't invent).

3. **RED.** Write the failing test that captures exactly one behavior from the
   spec, at the right layer:
   - Pure logic (tools, snapshot/reconciliation, verification layers) → **Vitest**
     unit test in the owning `packages/*`.
   - A user-visible agent behavior / invariant / safety case → **promptfoo** eval
     grounded in seed data (`add-eval-case`), tagged safety-critical if it is one.
   - A critical SSE flow → a thin **Playwright** smoke.
   Run it. Confirm it **fails for the right reason**. Mock at the boundary
   (OpenEMR HTTP client, Redis, Claude), never internal collaborators.

4. **GREEN.** Write the **minimum** code to pass — no speculative abstractions.
   Respect the rules as you go: `orchestrator-only` (logic in pure packages, thin
   LangGraph nodes), `authorization-and-pid-scope`, `provenance-and-grounding`,
   `typescript-standards`, `phi-and-secrets`, `error-handling-and-logging`.

5. **REFACTOR.** With tests green, clean up. Extract domain primitives, tighten
   types, remove duplication. Tests must stay green.

6. **VERIFY.** Run the relevant suite (`run-tests`). Before declaring a
   user-visible change done, exercise it end-to-end (the `verify` habit), not just
   unit tests. For anything safety-bearing, `pnpm eval:safety` must be 100% green.

7. **COMMIT-GATE.** Stage the change and draft a Conventional-Commits message with
   the `Assisted-by: Claude Code` trailer. **Then STOP and ask the user before
   committing / pushing / deploying** (`commit-and-deploy`). Never commit
   autonomously.

8. **RECORD.** Before returning to SELECT — and *always* before the session ends —
   write state to disk. Context does not survive; files do. **This step is not
   optional and is not "cleanup at the end";** a session that dies mid-loop must
   leave the next agent able to resume from files alone.
   - Update the **status column and artifact/gap cell** in `docs/week1-requirements.md`
     for anything the item moved.
   - Update the spec's **open questions** if implementation revealed anything.
   - Append a dated entry to `docs/JOURNAL.md` for any *decision, surprise, or
     dead end* — the "why" that a status table cannot hold. Skip it for routine
     green-path work; the journal is for what a future agent would otherwise
     re-litigate.
   - Update the `slice-status` memory if the overall build position changed.

9. **NEXT.** Return to SELECT.

> **Never hand off by writing a summary into the chat.** If the next agent needs to
> know it, it belongs in `week1-requirements.md`, `JOURNAL.md`, a spec, or a rule. Run
> `/resume-work` at the start of a session to reload position from those files.

---

## Stopping condition
Stop the loop when **either**:
- Every P0/P1 spec item for the **current milestone** is green (tests + relevant
  evals pass, safety subset 100%), and the milestone's deliverables in the PRD are
  met — then report milestone completion and await direction for the next; **or**
- You hit a decision only the user can make (a spec ambiguity that's a product
  choice, a missing credential/host fact behind a skill `TODO:`, or a
  commit/push/deploy gate) — stop and ask.

## Failure handling
- **Test won't go red / green for the wrong reason** → the test or the spec is
  wrong. Fix the spec first (`spec-driven-development.md`), then the test.
- **Implementation reveals the spec was wrong** → STOP. Fix the spec, get sign-off,
  then resume — do not let the code silently become the spec.
- **A safety-critical eval fails** → it is a hard blocker. Do not proceed, do not
  `--skip`, do not weaken the assertion. Fix the behavior.
- **A dependency/secret/host is missing** (skill `TODO:`) → stop and ask the user
  for the fact; capture it back into the skill file.
- **Flaky/ordering-dependent test** → fix the test's isolation; never disable "to
  fix later."
- **Blocked >1 iteration on the same item** → surface the blocker to the user with
  what you tried, rather than spinning.

## Definition of done (per spec item)
- Behavior matches the spec's acceptance criteria.
- Tests written first, green, and asserting observable behavior (not internals).
- Relevant rules satisfied (authz, provenance, verification, orchestrator-only,
  PHI/secrets, TS standards, logging).
- Safety-critical evals still 100% green.
- Change committed **after** user approval, deploy only if asked.
