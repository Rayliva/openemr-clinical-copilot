# Verification gate

Verification is defense-in-depth between generation and display
(`../ARCHITECTURE.md §2.5`). These rules keep it trustworthy.

## The rules
- **No user-facing clinical answer bypasses the gate.** Every response passes
  citation check → grounding check → constraint engine before display. No graph
  edge routes around it.
- **The constraint engine runs on structured facts, never prose.** Allergy /
  interaction / renal / duplicate-therapy rules read typed facts; they must never
  regex or parse the model's text. If a fact isn't in the structured layer, fix the
  source — don't scrape it back out of prose.
- **Contraindication logic is deterministic.** No probabilistic/LLM decision for
  anything safety-bearing. The grounding judge (the one LLM in the gate) sees
  **only** the cited source, never the whole snapshot.
- **Failure degrades gracefully** — bounded regenerate-with-feedback, then "here's
  what I can confirm; I could not verify X." **Never** a silent pass or a silent
  drop, never a crash shown to the user.
- Interaction/duplicate checks run on the **reconciled** med list, not one source.

## Why
An LLM cannot be trusted to reliably catch a contraindication; determinism on
structured facts is auditable and testable. Silent failure is worse than an honest
"I can't confirm."

## Do / Don't
- **Do:** flag "penicillin-class mention + documented penicillin allergy" from
  structured facts.
- **Don't:** let the constraint engine decide by reading the drafted sentence.
- **Do:** degrade to a partial, labeled answer when grounding fails.
- **Don't:** show an answer that failed the citation check.
