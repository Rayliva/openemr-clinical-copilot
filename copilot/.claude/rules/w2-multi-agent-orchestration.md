# Multi-agent orchestration (W2)

Week 2 turns the linear graph into a supervisor + two workers. This rule keeps the
supervisor inspectable and the safety spine intact. Extends `orchestrator-only.md`
(nodes stay thin); grounded in `../../W2_ARCHITECTURE.md §5`.

## The rules
- **The supervisor is not a black box.** It emits a **typed Zod routing decision** plus
  a **logged rationale** — never acts on raw model text, never routes silently.
- **Workers are thin wrappers** over pure packages: intake-extractor over
  `packages/ingestion`, evidence-retriever over `packages/rag`. No clinical,
  extraction, retrieval, or verification logic lives in a node.
- **The safety core always runs.** `assembleContext` (demographics, problems, meds,
  allergies) executes every turn regardless of routing — the constraint engine needs it.
- **No worker path bypasses the verification gate.** Every new edge converges back
  through citation → grounding → constraint → critic before `respond`.
- **Every handoff is traced.** Each worker invocation is a **Langfuse child span of the
  supervisor span**; the correlation ID flows through node state into every hop.
- **Routing loops are bounded.** Cap the supervisor's hops; a graph that never reaches
  `ready` must degrade, not hang.
- **Guideline evidence and patient-record facts stay separate** — never merged into one
  uncited claim.

## Why
Adding workers is where an agent becomes unexplainable. A typed, logged, traced
supervisor is auditable and testable; keeping logic in pure packages means the graph
can be swapped without touching safety-critical code.

## Do / Don't
- **Do:** `decision = RouteDecision.parse(llmOut)` → route + log rationale.
- **Don't:** branch on `llmOut.text.includes('extract')`.
- **Do:** worker node = `(s) => ({ ...s, evidence: retrieveEvidence(s.query) })`.
- **Don't:** inline the RRF/rerank logic inside the worker node.
