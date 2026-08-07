---
name: add-verification-check
description: Add or modify a check in the verification gate (packages/verification): the deterministic citation check, the LLM grounding judge, or the deterministic clinical-constraint engine. Use for any safety-critical trust-layer work — allergy/interaction/renal/duplicate-therapy rules, grounding, or citation enforcement.
---

# Skill: add-verification-check

## When to use
Adding or modifying a check in the verification gate (`packages/verification`): the
deterministic citation check, the semantic grounding judge, or the deterministic
clinical-constraint engine. This is the trust layer — treat it as safety-critical.

## The three layers (do not blur them)
1. **Citation check — deterministic, cheap.** Every claim is atomic
   `{ statement, source_refs[] }`; each ref must exist in the retrieved set. Pure
   function over structured data. No LLM.
2. **Grounding check — semantic.** An LLM-judge (Sonnet), given **only** the cited
   source, confirms it supports the statement. This is the *only* LLM in the gate.
3. **Constraint engine — deterministic, safety-critical.** Rules over **structured
   facts** (allergy/interaction/renal/duplicate-therapy). **Never runs on prose.**
   Contraindication detection must not be probabilistic.

## Steps
1. **Spec + failure mode first.** State exactly what the check catches and what it
   must never miss.
2. **TDD the pure module.** Write failing Vitest cases from the spec — include the
   adversarial case (a fabricated citation; a cited-but-misrepresented claim; a
   penicillin-class mention for the penicillin-allergic patient).
3. Implement as a **pure function** with typed input (structured facts / atomic
   claims) and a typed verdict (`pass | fail` + reason + which claims failed).
4. For the grounding judge only: the LLM call goes through the model registry
   (judge role); the **prompt lives in a versioned file**, and the judge sees only
   the cited source, never the whole snapshot.
5. Wire into the gate ordering (cite → ground → constraint) via a graph node
   (`add-graph-node`). On failure: bounded regenerate-with-feedback, then
   **degrade** ("here's what I can confirm; I could not verify X") — never silently
   drop.
6. Add eval cases (`add-eval-case`) — grounding/constraint checks are exactly the
   safety-critical must-pass set.

## Common pitfalls
- **Never let the constraint engine read prose.** If a rule is tempted to regex the
  model's text, the fact is missing from the structured layer — fix the source.
- **Don't let the judge see uncited context** — it will "confirm" from the wrong
  source. Feed it only the specific cited row.
- Data limits are real (`../ARCHITECTURE.md §2.5`): the seeded penicillin allergy
  has **no severity**, so severity rules can't fire — surface "documented, severity
  unknown," don't infer mild. Run interaction checks on the **reconciled** med list,
  not one source.
- A failing verification must degrade gracefully; a crash or a silent pass is a
  worse outcome than "I can't confirm X."
