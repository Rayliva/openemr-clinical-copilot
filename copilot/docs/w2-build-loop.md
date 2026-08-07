# W2 Build loop — Spec-first TDD, gated by CI

The build procedure for **Week 2** (Multimodal Evidence Agent). Same loop choice as
Week 1 ([`build-loop.md`](build-loop.md)) — spec-first TDD — because
`test-driven-development.md` and `spec-driven-development.md` remain mandatory, the
success metrics are concrete numbers, and the whole design is testable behavior. The one
structural change: **the eval-driven CI gate is now a hard, PR-blocking standard**, not
just a local convenience. Run it via `/build`.

Re-run `/pick-loop` any time to switch. This loop is not permanent.

---

## Inputs (read before each work session)
- `docs/w2-PRD.md` — W2 scope, priorities (P0/P1/P2), success metrics, checkpoints.
- `../W2_ARCHITECTURE.md` — the W2 architecture (ingestion, worker graph, RAG, eval
  gate, data model, failure modes, testing strategy).
- `docs/PRD.md`, `docs/tech-spec.md`, `../ARCHITECTURE.md`, `../AUDIT.md`, `../USERS.md`
  — the Week 1 foundation W2 builds on; they win on conflict.
- Everything in `.claude/rules/` — incl. the three `w2-*` rules.
- `.claude/skills/INDEX.md` — incl. the Week 2 skills.
- Memory: `slice-status`, `week2-requirements-tracker`, `w2-ci-runner-plan`,
  `week-scoping-convention`.

## The unit of work: one **spec item**
The smallest observable behavior that traces to a W2 core requirement (PDF 1–7), a
deliverable, or a success metric. Pulled in **priority order** (P0→P1→P2) respecting the
checkpoints (Central time):
- **MVP (Tue 11:59 PM):** **P0 prerequisite — synthetic fixtures first:** the demo
  anchor patient + the synthetic lab-PDF / intake-form documents (the fixtures the eval
  golden set *and* the offline integration tests both depend on) must exist before those
  can be built. Then: two document types ingesting (extract→review→commit); basic hybrid
  RAG + rerank; supervisor + 2 workers with logged handoffs; the 50-case eval +
  PR-blocking gate scaffolded; W2 flow reachable in the app.
- **Early (Thu 11:59 PM):** citation contract + PDF bbox overlay; click-to-source review
  UI; W2 observability signals (retrieval hits, extraction confidence, eval outcome);
  the LLM critic; `W2_ARCHITECTURE.md` complete.
- **Final (Sun Noon):** OpenAPI 3.0 + contract tests; integration tests (fixtures+stubs);
  data-lineage + PHI-audit + backup docs; W2 alerts + baselines; deploy; demo support.

---

## The loop body (one iteration)

Repeat until the stopping condition holds.

1. **SELECT.** Highest-priority unfinished W2 spec item for the current checkpoint.
   State it in one line + the PDF requirement / metric it traces to. If it traces to
   none, don't build it yet. Mark it `w2` (spec, eval tag, artifact).

2. **SPEC.** If no written spec exists, write `docs/specs/w2-<feature>.md` (behavior,
   boundaries, acceptance criteria, open questions) per `spec-driven-development.md`.
   **If a spec ambiguity is a real product decision, stop and ask.**

3. **RED.** Write the failing test for exactly one behavior, at the right layer:
   - Pure logic (ingestion/extraction, RAG, supervisor decision, verification) →
     **Vitest** unit test in the owning `packages/*`.
   - The full ingest→answer path → an **integration test** with **fixture documents +
     stubbed VLM/LLM/Cohere** (must run offline in CI).
   - A user-visible agent behavior / invariant / safety case → **promptfoo** eval,
     tagged `week:2` (`add-eval-case` / `w2-eval-ci-gate`), safety-tagged if it is one.
   Run it; confirm it fails for the right reason. Mock at the boundary, never internals.

4. **GREEN.** Minimum code to pass. Respect the rules — `w2-document-ingestion-writes`
   (schema-canonical, module-writes, confirm-before-commit), `w2-multi-agent-
   orchestration` (thin nodes, typed routing, traced handoffs), `orchestrator-only`,
   `authorization-and-pid-scope`, `provenance-and-grounding`, `verification-gate`,
   `phi-and-secrets`, `typescript-standards`, `error-handling-and-logging`. Use the W2
   skills.

5. **REFACTOR.** Tests green → clean up (domain primitives, tighten types, dedupe).
   Tests stay green.

6. **VERIFY.** Run the relevant suite (`run-tests`). Before declaring a user-visible
   change done, exercise it end-to-end (the `verify` habit) — for ingestion that means
   a real extract→review→commit on a fixture doc. Safety subset `pnpm eval:safety` must
   be 100%.

7. **CI-GATE (new in W2).** The change must pass the **PR-blocking gate**
   (`w2-eval-ci-gate`): lint, typecheck, tests, coverage, the 50-case eval, dep-audit,
   security scan, contract tests — on the GitLab-CI droplet runner (+ local `prek`
   hook). The eval regression check must be green (no category > 5% down). If setting up
   the runner is problematic, **stop and inform the user** (fallback per
   `w2-ci-runner-plan`). **Self-test the gate at least once**: inject a regression,
   confirm red, revert.

8. **COMMIT-GATE.** Stage + draft a Conventional-Commits message with the
   `Assisted-by: Claude Code` trailer. **STOP and ask before committing / pushing /
   deploying** (`commit-and-deploy`). Never commit autonomously.

9. **RECORD.** Before returning to SELECT — and always before the session ends — write
   state to disk (files survive, context doesn't):
   - Flip the matching card in **`docs/week2-requirements.html`** (`data-status`
     red→amber→green; refresh the note; bump `#updated`). Green = done **and verified**.
   - Update the spec's open questions if implementation revealed anything.
   - Append a dated entry to `docs/JOURNAL.md` for any decision/surprise/dead-end.
   - Update the `slice-status` memory if the overall build position changed.

10. **NEXT.** Return to SELECT.

> **Never hand off by writing a summary into the chat.** If the next agent needs it, it
> belongs in `week2-requirements.html`, `JOURNAL.md`, a spec, or a rule. Run
> `/resume-work` at the start of a session to reload position.

---

## Parallel mode (optional)

Serial iteration (above) is the **default**. When a remaining chunk genuinely
decomposes into independent, file-disjoint work, you may fan out — but only under the
discipline in `.claude/rules/parallel-work-isolation.md`. It is additive: it replaces
nothing above and requires no re-bootstrap.

**When to reach for it:** a chunk of ≥2 non-trivial, genuinely independent leaf
features whose files don't overlap (e.g. two separate `packages/*`). Not for small
slices — a fresh builder worktree needs its own `pnpm install` before vitest runs
(`copilot/node_modules` is gitignored), which on Windows costs minutes and competes for
disk IO, so the speedup only pays off for substantial independent work. Keep waves to
~2–3 builders.

**The procedure:**
1. Run `/plan-work` against the chunk's specs → it writes `docs/work-manifest.md` with
   per-task **write/read scopes** and dependency-ordered **waves**, and flags anything
   that can't be made disjoint. **Show the wave plan to the user and get approval before
   fanning out** (per `parallel-work-isolation` + `commit-and-deploy`).
2. If it does **not** cleanly decompose, build that chunk **serially** as usual — do not
   force parallelism onto work that resists it.
3. If it does: the orchestrator **freezes and commits any new shared contract first**
   (ask before the commit), so it is read-only in every builder's scope.
4. For each task in a wave, launch a **`builder`** sub-agent with `isolation: "worktree"`
   — all of a wave's builders in **one message** so they run concurrently — handing each
   only its task's spec + write scope + read scope from the manifest.
5. **Integrate builder diffs one at a time** in the main tree, running the **full** suite
   green after each, then delegate the integrated wave's diff to `code-reviewer` before
   unlocking the next wave.

**Never parallelize** the verification gate, the constraint engine, the supervisor
routing core, anything touching global/shared state, **or any PHP-module
(`oe-module-copilot`) change** — those are `copilot/`-external and need the OpenEMR
container a raw worktree lacks, so they are built serially in the main tree. **Never
assign the same file to two builders in a wave**; if two slices both need an existing
shared file (a graph node, a barrel export), `/plan-work` flags it — split the file or
serialize those slices.

---

## Stopping condition
Stop when **either**:
- Every P0/P1/P2 spec item for the **current checkpoint** is green (tests + relevant
  evals pass, safety subset 100%, CI gate green) and the checkpoint's deliverables are
  met — report completion and await direction; **or**
- You hit a decision only the user can make (a product ambiguity, a missing
  credential/host fact behind a skill `TODO:`, the runner fallback, or a
  commit/push/deploy gate) — stop and ask.

## Failure handling
- **Test won't go red / green for the wrong reason** → the test or spec is wrong; fix
  the spec first, then the test.
- **Implementation reveals the spec was wrong** → STOP, fix the spec, get sign-off.
- **A safety-critical eval fails** → hard blocker; do not proceed, do not `--skip`, do
  not weaken the assertion.
- **The CI gate can't be made to fail on an injected regression** → the gate is not
  real yet; fix it before trusting green (`w2-eval-gate`).
- **VLM emits out-of-contract output** → bounded retry with schema feedback, then
  degrade with the field flagged — never bypass the schema.
- **Droplet runner problematic** → stop, inform the user, fall back to the local hook.
- **Blocked > 1 iteration on the same item** → surface the blocker with what you tried.

## Definition of done (per spec item)
- Behavior matches the spec's acceptance criteria.
- Tests written first, green, asserting observable behavior (not internals); integration
  tests run offline with fixtures+stubs.
- Relevant rules satisfied (the three `w2-*` rules + the W1 set).
- Safety-critical evals 100%; the CI gate green (no category regressed > 5%).
- The `week2-requirements.html` card updated.
- Change committed **after** user approval; deploy only if asked.
