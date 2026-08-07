---
description: Propose additional project-specific rules beyond the defaults
---

The template ships with two required rules:
- `.claude/rules/spec-driven-development.md`
- `.claude/rules/test-driven-development.md`

Confirm both files exist. If not, halt and tell the user the template is incomplete.

## Process

1. Read `docs/PRD.md` and `docs/tech-spec.md`.

2. Propose additional rules that should govern work in this project. Common candidates:
   - `commit-style.md` — commit message conventions
   - `pr-style.md` — PR description format, review expectations
   - `naming.md` — naming conventions for files / variables / DB tables
   - `error-handling.md` — error handling philosophy
   - `logging.md` — what to log, what not to log
   - `secrets.md` — how secrets are stored and accessed
   - `dependencies.md` — when adding a new dependency is OK
   - `accessibility.md` — a11y standards (if there is a UI)
   - `security.md` — project-specific security rules

3. Present the list to the user. Ask which to keep, drop, or add.

4. For each approved rule, write `.claude/rules/<name>.md` with:
   - Title
   - The rule(s) — concrete, enforceable in code review
   - Why (rationale, short)
   - Examples (do / don't)

5. Update `CLAUDE.md` so the "Required reading" section enumerates every rule file currently in `.claude/rules/`.

## Rules

- A rule must be enforceable in code review. "Be a good engineer" is not a rule. "All exported functions must have a return type annotation" is.
- Keep each rule file under 50 lines. If it's longer, it's probably two rules.
- Do not contradict the spec-driven or test-driven rules.
