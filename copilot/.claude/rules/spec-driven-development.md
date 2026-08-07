# Spec-driven development

All non-trivial work in this project starts from a written spec. Code is downstream of specs.

## The rule

Before writing implementation code for a feature, write a spec for it. The spec is the source of truth for what the feature does. If the spec is wrong, fix the spec first, then the code.

## What a spec must contain

- **Behavior:** what the system does, in observable terms (inputs → outputs, side effects).
- **Boundaries:** what it does NOT do.
- **Acceptance criteria:** concrete, testable statements ("when X, then Y").
- **Open questions:** anything undecided.

## Where specs live

- Feature specs: `docs/specs/<feature>.md`
- Per-task specs: in the task description / PR body, linked to the feature spec.

## Why

Specs surface ambiguity *before* code commits to it. They let parallel work converge. They let tests be written from intent rather than from implementation.

## How to apply

- For any feature larger than ~50 lines of code: write or update a spec first.
- For bug fixes: the bug report IS the spec. Reference it.
- If the user gives a verbal request, restate it as a spec and confirm before coding.
- If implementation reveals the spec was wrong, *stop*. Fix the spec, get sign-off, then resume.

## Anti-patterns

- "I'll write the spec after, from the code." No — the code becomes the spec, and the chance to question it is gone.
- Vague specs like "should be fast." Replace with "p95 latency under 200ms at 100 RPS."
- Specs that describe implementation ("uses a Redis cache") instead of behavior ("reads return within 50ms").
