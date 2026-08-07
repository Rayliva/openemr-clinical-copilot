# Orchestrator-only

LangGraph.js was chosen for future extension (`future-proof-extensibility` memory),
on the condition that it only ever *orchestrates*. This rule protects the
safety-critical logic from framework churn.

## The rules
- **LangGraph nodes are thin wrappers**: read typed state → call a pure module →
  write typed state. No node contains clinical logic, reconciliation, verification,
  or data mapping.
- All such logic lives in **pure `packages/*` modules** (`tools`, `snapshot`,
  `verification`, `openemr-client`) with their **own unit tests**, importable and
  testable without LangGraph.
- The graph depends on the packages; **packages never import LangGraph.**
- No provider/model is hardcoded in a node — call through the model-role
  abstraction.

## Why
If LangGraph disappoints or its API churns, we swap the shell, not the logic. It
also keeps the verification/constraint code unit-testable in isolation, which is
how we prove the safety guarantees.

## Do / Don't
- **Do:** `node = (s) => ({ ...s, meds: reconcileMeds(s.raw) })` where
  `reconcileMeds` is a tested pure function.
- **Don't:** inline the reconciliation union/dedupe/conflict logic inside the node.
- **Do:** unit-test `reconcileMeds` with no graph involved.
- **Don't:** `import { StateGraph } from '@langchain/langgraph'` inside
  `packages/verification`.
