---
name: w2-supervisor-workers
description: Add or change the Week 2 supervisor + worker multi-agent graph — a supervisor node that routes on a typed Zod decision to the intake-extractor and evidence-retriever workers, with logged handoffs as Langfuse child spans. Use when wiring the supervisor routing, a worker node, the routing decision contract, or the supervisor↔worker handoff/trace.
---

# Skill: w2-supervisor-workers

## When to use
Wiring the Week 2 multi-agent graph: the supervisor router, the intake-extractor /
evidence-retriever workers, the routing-decision contract, or the handoff spans.
Builds on `add-graph-node` (the orchestrator-only base mechanics); this skill adds the
multi-agent specifics. See `W2_ARCHITECTURE.md` §5.

## The invariants
- **Orchestrator-only still holds.** The supervisor and workers are **thin nodes**;
  all logic lives in pure packages (workers wrap `packages/ingestion` /
  `packages/rag`). No clinical/reconciliation/verification logic in a node.
- **The safety core always runs** (`assembleContext`) regardless of routing — the
  constraint engine needs demographics/problems/meds/allergies every turn.
- **Nothing routes around the verification gate.** Every user-facing answer still
  passes citation → grounding → constraint → critic (`verification-gate`).
- **The supervisor is not a black box** — it emits a **typed decision + a logged
  rationale** (PDF pitfall).

## Steps
1. **Spec first** at `docs/specs/w2-supervisor.md`: the decision contract, routing
   rules (when extract / when retrieve / when ready), and the handoff shape.
2. **Typed routing decision (Zod):** e.g.
   `{ need_extract: bool, need_evidence: bool, ready: bool, rationale: string }`.
   Parse the supervisor LLM output into this — never act on raw text.
3. **Supervisor node:** a bounded LLM router (model-role abstraction) → typed
   decision → route. Log the rationale. Bound the loop (max hops) to avoid cycles.
4. **Worker nodes (thin):**
   - **intake-extractor** → wraps `packages/ingestion` (`w2-ingest-document`).
   - **evidence-retriever** → wraps `packages/rag` (`w2-hybrid-rag`).
   Each reads typed state → calls the pure module → writes typed state.
5. **Handoffs = Langfuse child spans.** Each worker invocation is a **child span of
   the supervisor span**; extraction/retrieval sub-calls trace within their worker
   span. **Correlation ID** flows through node state into every hop
   (`error-handling-and-logging`, `W2_ARCHITECTURE.md` §9).
6. **Graph flow:** `assembleContext → supervisor → {intake-extractor |
   evidence-retriever} → (loop to supervisor until ready) → generate → gate → critic
   → respond`.
7. **Tests:** a **supervisor↔worker contract test** (guard: handoff schema drift) +
   a decision-reducer unit test (guard: invalid routing state); both in the
   PR-blocking suite (`w2-eval-ci-gate`). Dashboard: log routing decisions +
   per-worker latency.

## Common pitfalls
- **Fat supervisor/worker nodes are a smell** — push logic into the pure package.
- **Unbounded routing loops** — cap the hops; a supervisor that never decides `ready`
  hangs the turn.
- **Untyped handoffs** — a stringly-typed decision defeats the contract-first design
  and breaks the contract test.
- **Silent handoffs** — every routing decision must be logged/traced; an unexplained
  route is exactly the black box the PDF warns against.
- **Don't let a worker path skip the gate** — new edges converge back through
  verification before `respond`.
