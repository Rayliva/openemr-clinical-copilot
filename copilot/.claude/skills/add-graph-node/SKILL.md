---
name: add-graph-node
description: Add or change a node or edge in the LangGraph.js agent graph in apps/agent, keeping nodes as thin wrappers over pure modules per the orchestrator-only rule. Use when adding a tool step, a routing branch, or a human-in-the-loop approval.
---

# Skill: add-graph-node

## When to use
Adding or changing a node/edge in the LangGraph.js agent graph (`apps/agent`) —
e.g. a new tool step, a routing branch, or a future human-in-the-loop approval.

## The invariant (orchestrator-only rule)
LangGraph **only orchestrates**. A node is a **thin wrapper** that calls a pure
module in `packages/*`. No clinical logic, reconciliation, or verification lives in
a node — those live in `tools` / `snapshot` / `verification` and are unit-tested
independently. If LangGraph is ever swapped out, only the wrappers change.

## Steps
1. Confirm the logic you're wiring already exists as a **pure module** with its own
   tests. If not, build it there first (`add-tool` / `add-verification-check`).
2. Add the node in the graph definition: read typed state in, call the pure module,
   write typed state out. Keep the node body small.
3. Add edges. The core path stays: assemble → generate → cite-check → ground-check
   → constraint-engine → (bounded retry) → degrade/finish. New branches must not
   bypass the verification gate.
4. Attach observability: the **correlation ID** flows through node state; each node
   is a Langfuse span (latency/tokens/cost).
5. For a future write/approval flow, use LangGraph's `interrupt` at the node — the
   reason this framework was chosen (`future-proof-extensibility`).
6. Test the node's wrapper behavior (state in → module called → state out) and rely
   on the pure module's own tests for the logic.

## Common pitfalls
- **Fat nodes are a smell.** If a node has real logic, it's in the wrong place —
  push it into a pure package.
- **No edge may route around verification** for anything shown to the user.
- Don't hardcode a provider/model in a node — use the model-role abstraction.
- Keep state typed (Zod/TS); untyped graph state defeats the whole contract-first
  design.
