# Spec — W2 supervisor + workers graph wiring

> Feature spec for inserting the supervisor + two worker nodes into the LangGraph graph, using
> the routing decision from `docs/specs/w2-supervisor-routing.md`. Grounded in `Week_2_AgentForge.pdf`
> Core Req 4, the `w2-multi-agent-orchestration` rule (safety core always runs, no worker bypasses
> the gate, handoffs traced, bounded loop), `orchestrator-only` (thin nodes), and
> `../../W2_ARCHITECTURE.md §5`.

## Behavior

### The new graph shape
```
assembleContext → gather → supervisor ⇄ { intake_extractor, evidence_retriever } → generate
  → verify → grounding → constraints → respond
```
- **`assembleContext` (safety core) is unchanged and always runs first** — demographics,
  problems, meds, allergies — so the constraint engine always has its inputs
  (`w2-multi-agent-orchestration`).
- **`gather` is unchanged** (the W1 optional-tool step).
- **`supervisor`** runs the injected router, applies `decideRoute` (bounded/typed/logged), and
  sets `state.route`. A conditional edge sends the turn to the chosen worker or to `generate`
  when `ready`.
- **Workers** (`intake_extractor` over `packages/ingestion`; `evidence_retriever` over
  `packages/rag`) are **thin** nodes over injected ports; each marks itself routed and edges
  **back to `supervisor`** (the loop). Absent port → the worker is a no-op that still records
  the handoff (structure holds before the bodies land).
- **The verification gate path is byte-identical** to W1: `generate → verify → grounding →
  constraints → respond`. **No new edge routes around it** — every worker path returns through
  the supervisor and can only exit via `generate`.

### Backward-compatible by construction
- When **no supervisor router is injected** (`deps.supervisor` absent — all W1 tests, the
  chart-only fast path), the `supervisor` node returns `{ route: "ready" }` **without any model
  call**, so the flow is exactly W1 (`gather → supervisor(no-op) → generate → …`). Every
  existing graph/chat/safety test must stay green unchanged.
- **Answer-identical, not byte-identical at the trace layer:** a no-op `supervisor` span is now
  emitted on *every* turn (including the W1 config). No behavior changes, but an observability
  assertion that checks the exact span sequence must account for it.

### New injected deps (all optional)
- `supervisor?: SupervisorRouter` — the routing LLM (absent → no-op ready).
- `intakeExtractor?` — port the `intake_extractor` node calls (absent → no-op handoff).
- `evidenceRetriever?` — port the `evidence_retriever` node calls (absent → no-op handoff).
- `supervisorModelName?`, `supervisorMaxHops?` (default 2).

### New state
- `route: RouteTarget` (default `ready`), `supervisorHops: number` (default 0),
  `routedWorkers: RouteTarget[]` (default `[]`), `evidence: string[]` (default `[]`, written by
  the evidence-retriever; generation-consumption is the RAG slice).

### Tracing (handoffs)
- Each `supervisor` hop is a span carrying `{ route, rationale, hops }` (the rationale is
  **logged** — anti-black-box). Each worker invocation is a span. Strict Langfuse
  child-span-of-supervisor nesting is a documented refinement; MVP emits per-node spans + the
  correlation id + `routedWorkers`, so the handoff sequence is reconstructable.

## Boundaries
- **No worker bodies beyond the injected-port call.** intake-extractor's real extraction/draft
  flow and evidence-retriever's real RAG are their own slices; here the ports may be absent.
- **No change to `generate`/`verify`/`grounding`/`constraints`/`respond`** logic. `evidence` is
  threaded into state but not yet fed to `generate` (RAG slice).
- **No change to the pid-scope / auth model** (`authorization-and-pid-scope`).

## Acceptance criteria
- **No regression:** with no supervisor injected, the graph produces the same outcome as W1 for
  a chart question (existing graph/chat/safety tests green; a new test asserts `route === "ready"`
  and neither worker ran).
- **Routing:** with a stub router that says `intake_extractor` once then `ready`, the turn runs
  the intake_extractor node exactly once, then reaches `generate` and the full gate, and answers.
- **Both workers:** a router that routes to both workers (then ready) visits each once; each
  appears in `routedWorkers`; the gate still runs.
- **Bounded:** a stub router that *always* says `intake_extractor` still terminates (hop cap →
  forced `ready`) and answers — never an infinite loop.
- **No double-run:** a router that repeats a worker already in `routedWorkers` is forced to
  `ready` (from `decideRoute`); the worker runs at most once.
- **Gate not bypassed:** on every routed path, `constraints` (and `verify`) still execute — a
  test asserts a safety finding still fires when a worker was routed.
- **Safety core always:** `assembleContext` runs regardless of routing (asserted).

## Open questions
- **Strict Langfuse child-span nesting** (worker span under supervisor span) — MVP uses per-node
  spans; true nesting is a tracing-context refinement, deferred.
- **`evidence` → `generate` consumption** — deferred to the RAG slice (the retriever writes it;
  generate reads it once guideline evidence is real, kept separable from chart facts per the
  rule "guideline evidence and patient-record facts stay separate").
- **Whether `gather` folds into the supervisor** eventually — kept separate for now (minimal
  change, lowest risk to the W1 path).
