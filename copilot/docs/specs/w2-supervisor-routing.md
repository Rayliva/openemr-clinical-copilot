# Spec — W2 supervisor routing decision (contract + bounding)

> Feature spec for the **supervisor's routing decision** — the typed, logged, bounded decision
> that turns the Week 1 linear graph into a supervisor + workers graph without becoming a black
> box. Grounded in `Week_2_AgentForge.pdf` Core Req 4 (supervisor + two workers), the
> `w2-multi-agent-orchestration` rule ("typed Zod routing decision + logged rationale; never
> raw model text; bounded hops; degrade not hang"), `orchestrator-only`, and
> `../../W2_ARCHITECTURE.md §5`. Module: `apps/agent/src/graph/supervisor.ts` (pure decision +
> injected router, following the `gather.ts` precedent).

## Context — where this sits

The graph today is linear: `assembleContext → gather → generate → verify → grounding →
constraints → respond`. Week 2 inserts a **supervisor** after the always-on safety core that
routes to the two required workers — **intake-extractor** (over `packages/ingestion`) and
**evidence-retriever** (over `packages/rag`) — before generation. This slice is **only the
decision contract + the pure bounding/parse logic**; wiring the nodes/edges into the graph is
the next slice. The supervisor's *model call* is injected (like `generate`/`gather`), so the
decision logic is offline-testable with a stub.

## Behavior

### 1. The routing decision contract (typed, the anti-black-box)
`RouteDecision` (Zod — the supervisor never acts on raw model text):
- `next` — enum `intake_extractor | evidence_retriever | ready`. `ready` = no more workers
  needed, proceed to `generate`.
- `rationale` — non-empty string; the supervisor's reason, **logged** on every hop
  (`w2-multi-agent-orchestration`: "logged rationale").

The injected router `SupervisorRouter = (input) => Promise<unknown>` returns raw model output;
the supervisor **parses** it against `RouteDecision` at the boundary (parse, don't validate).

### 2. Bounded, degrade-not-hang routing — `decideRoute(raw, ctx)`
Pure. Given the router's raw output and `ctx = { hops, maxHops, alreadyRouted }`, produce a
`RoutingOutcome = { next, rationale }`:
- **Parse the raw output.** On a Zod failure → **degrade to `ready`** with a rationale noting
  the parse failure — never route on garbage, never throw (the turn still answers from the
  safety core). This is the "never acts on raw model text / never routes silently" guarantee.
- **Bound the hops.** If `hops >= maxHops` → force `next: "ready"` regardless of the model
  (a graph that never reaches `ready` must **degrade, not hang** — bounded loop).
- **No worker runs twice.** If the model routes to a worker already in `alreadyRouted`, force
  `ready` (each worker contributes once per turn; prevents an oscillation loop under the cap).
- Otherwise pass through the parsed `next` + `rationale`.

### 3. Safety invariants encoded here
- The decision can only ever choose a **known worker or `ready`** (enum-closed) — a new/unknown
  route is a parse failure → `ready`.
- `decideRoute` is **total** (never throws) and **bounded** (always converges to `ready`).

## Boundaries (what this slice does NOT do)
- **No graph wiring.** Adding the supervisor/worker nodes + conditional edges, keeping the
  safety core always-on, and routing every path back through the verification gate is the
  next slice.
- **No worker implementations.** intake-extractor (ingestion) and evidence-retriever (RAG) are
  their own slices; here they are only *names the router may choose*.
- **No live model call.** The router is injected; this slice tests the parse/bound/dedupe logic
  with stubs.
- **No Langfuse span wiring** (the child-span-per-handoff tracing lands with the graph wiring).

## Acceptance criteria
- A well-formed `{ next: "intake_extractor", rationale }` parses and passes through.
- An invalid `next` (`"delete_chart"`) or a missing `rationale` → `decideRoute` degrades to
  `{ next: "ready", ... }` (parse failure), never throws.
- `hops >= maxHops` forces `ready` even when the model says otherwise.
- A worker already in `alreadyRouted` → forced `ready` (no double-run / oscillation).
- Raw non-JSON / null / wrong-typed router output → `ready`, no throw.
- The rationale is preserved on a valid pass-through and set to a descriptive string on every
  degrade (so the log always has a reason).

## Open questions
- **maxHops value** — proposed 2 (each worker at most once) for the two-worker MVP; revisit if a
  worker can legitimately be revisited. Recorded, not blocking.
- **Whether `ready` should be inferable** when the safety core already answers a chart-only
  question without either worker — yes; the supervisor may return `ready` on the first hop (the
  chart-only fast path), decided in the graph-wiring slice.
