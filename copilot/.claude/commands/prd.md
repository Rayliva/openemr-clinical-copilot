---
description: Interview the user and draft a detailed PRD at docs/PRD.md
---

Draft a Product Requirements Document for this project at `docs/PRD.md`.

## Process

Ask the user the following ONE QUESTION AT A TIME, waiting for an answer before moving on. After every answer, restate it briefly to confirm before asking the next question.

1. **Problem** — what problem does this product solve, and for whom?
2. **Users** — who are the target users? Personas, expected scale.
3. **Core value** — what is the single most important outcome a user gets?
4. **Scope (in)** — what features must ship in v1?
5. **Scope (out)** — what is explicitly NOT in v1?
6. **Success metrics** — how do we know v1 is working? Use specific numbers.
7. **Constraints** — budget, deadlines, compliance, platform restrictions.
8. **Risks** — what could kill the project?
9. **Open questions** — what is still undecided?

Once all questions are answered, write `docs/PRD.md` using this structure:

- Title + one-paragraph summary
- Problem
- Users / personas
- Goals & success metrics
- In-scope features (numbered, prioritized)
- Out-of-scope
- Constraints
- Risks & mitigations
- Open questions

Show the user the final PRD path and ask them to confirm before exiting.

## Rules

- Do not invent answers. If the user says "I don't know," put it in Open Questions.
- Keep questions focused — don't bundle multiple questions into one.
- Record uncertainty rather than papering over it.
