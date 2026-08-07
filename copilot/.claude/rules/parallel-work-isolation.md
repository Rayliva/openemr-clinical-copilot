# Parallel work isolation

When more than one agent works at the same time, correctness depends on the work
being **decomposed into file-disjoint units that talk only through frozen
contracts**. This rule is what makes parallelism safe instead of a source of merge
and semantic conflicts. It applies whenever the build loop fans out (see the
"Parallel fan-out loop" in `docs/build-loop.md`).

## The rules

- **Every parallel unit has an explicit write scope.** Before any agent starts, a
  work manifest (`docs/work-manifest.md`) lists, per task, the files that task may
  **write** and the files it may only **read**. No file appears in the write scope
  of two concurrent tasks. If two tasks need the same file, they are not parallel —
  serialize them or split the file first.

- **Contracts are frozen before fan-out.** Shared interfaces — Zod schemas, package
  public types, exported function signatures, DB/migration schemas, API shapes — are
  written and committed by the orchestrator *before* builders start. They live in
  each task's read-only scope, never its write scope.

- **A builder never edits a shared contract.** If a builder discovers the frozen
  contract is wrong or insufficient, it **stops and hands back to the orchestrator**
  with the problem stated. It does not change the interface unilaterally. The
  orchestrator amends the contract, re-freezes, and re-fans-out affected tasks.

- **Each builder runs in isolation.** Builders work in their own git worktree (Agent
  tool `isolation: "worktree"`) or on their own branch, and return a diff. They do
  not push to a shared branch and do not merge their own work.

- **One integrator merges.** A single actor (the orchestrator) merges builder diffs,
  runs the **full** test suite (not just the per-task tests), and resolves any
  conflict. Integration is serial even when building is parallel.

- **The safety-critical core is never parallelized.** The verification gate, the
  constraint engine, contract definitions, and anything touching global/shared state
  are built serially by the orchestrator. Parallelize leaf features, not the spine.

## Why

Merge conflicts and — worse — silent semantic conflicts come from two agents
touching the same file or from one moving an interface the other built against.
Disjoint write scopes remove the first by construction; frozen contracts plus
"escalate, don't mutate" remove the second. Worktree isolation plus a single
integrator means no half-merged state is ever visible to another builder.

## Do / Don't

- **Do:** give task A `packages/labs/**` and task B `packages/meds/**`, both reading
  the frozen `packages/contracts/**`.
- **Don't:** let task A and task B both edit `packages/contracts/schema.ts`.
- **Do:** builder hits a missing field → stops, reports "contract needs `unit` on
  LabResult" → orchestrator amends and re-freezes.
- **Don't:** builder adds the field to the shared schema itself and keeps going.
- **Do:** integrate diffs one at a time, full suite green after each.
- **Don't:** have three builders push to `main` concurrently.
