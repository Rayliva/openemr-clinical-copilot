---
description: Decompose the next chunk of work into a file-disjoint, dependency-ordered work manifest for parallel building
---

Turn the pending spec items into a **work manifest** the parallel build loop can fan
out safely. The manifest is the coordination surface that prevents parallel agents
from conflicting. Produce it, show it to the user, and get approval before any
building starts.

Read first: `docs/PRD.md`, `docs/tech-spec.md`, `docs/specs/*`, every file in
`.claude/rules/` (especially `parallel-work-isolation.md`), and the current tree
layout. You are planning; do not write implementation code.

## Steps

1. **Enumerate the candidate tasks.** From the specs, list the units of work in the
   next build chunk. Each task = one coherent behavior with acceptance criteria.

2. **Map each task to a write scope.** For every task, list the files/globs it will
   create or edit. Be concrete — real paths, not "the labs stuff." If you can't name
   the files, the task isn't ready to build; split or spec it further.

3. **Detect the contracts.** Identify every shared interface two or more tasks depend
   on (Zod schemas, package public types, exported signatures, DB schema, API shape).
   These become a **contract-freeze task** owned by the orchestrator, done *before*
   fan-out. No builder gets a contract file in its write scope.

4. **Check disjointness.** No file may be in the write scope of two tasks that you
   intend to run concurrently. If two tasks overlap:
   - split the file so each owns a part, or
   - serialize them (make one depend on the other), or
   - merge them into one task for a single builder.
   State which resolution you chose and why.

5. **Order by dependency.** Build the DAG: task B depends on task A if B reads what A
   produces or B's contract is frozen by A. Group into **waves**: wave 0 = the
   contract-freeze + anything with no deps; each later wave unlocks once the prior
   wave is integrated. Within a wave, all tasks are file-disjoint and run in parallel.

6. **Flag the serial-only work.** Mark tasks touching the verification/safety core,
   global state, or shared config as **serial** — they run in the orchestrator, never
   fanned out, regardless of wave.

7. **Write `docs/work-manifest.md`** using the shape below, then present the wave
   plan (how many parallel builders per wave) and ask the user to approve.

## `docs/work-manifest.md` shape

```md
# Work manifest — <chunk name>

## Wave 0 — contracts & prerequisites (serial, orchestrator)
- **T0 freeze-contracts** — write/commit: `packages/contracts/**`
  - Interfaces: <list the schemas/types being frozen>

## Wave 1 — parallel
- **T1 <name>** — depends: [T0]
  - write scope: `packages/labs/**`, `apps/agent/nodes/labs.ts`
  - read scope: `packages/contracts/**`
  - spec: docs/specs/labs.md — acceptance: <criteria>
- **T2 <name>** — depends: [T0]
  - write scope: `packages/meds/**`
  - read scope: `packages/contracts/**`
  - spec: docs/specs/meds.md — acceptance: <criteria>

## Wave 2 — parallel (unlocks after Wave 1 integrated)
- **T3 <name>** — depends: [T1, T2]
  - write scope: `packages/reconcile/**`
  - read scope: `packages/labs/**`, `packages/meds/**`, `packages/contracts/**`

## Serial-only (never fanned out)
- **S1 verification gate** — write scope: `packages/verification/**` — reason: safety core
```

## Rules

- Disjoint write scopes within a wave are non-negotiable — this is the whole point.
- Prefer fewer, cleaner waves over maximal parallelism. Two safe waves beat one
  risky wide fan-out.
- If you cannot make the tasks disjoint, say so and recommend building that chunk
  serially. Do not force parallelism onto work that resists it.
