---
description: Interview the user about technical choices and draft docs/tech-spec.md
---

Draft a technical specification for this project at `docs/tech-spec.md`.

## Prerequisite

`docs/PRD.md` should exist. If it does not, prompt the user to run `/prd` first and stop.

## Process

Ask the user the following ONE QUESTION AT A TIME. After every answer, restate it briefly to confirm before asking the next question.

1. **Language & runtime** — primary language and version
2. **Framework(s)** — web framework, app framework, etc.
3. **Data layer** — database(s), cache, search, queues
4. **Hosting / deployment** — where does this run? (Vercel, AWS, self-hosted, etc.)
5. **Auth** — identity provider, session strategy
6. **External services** — payments, email, analytics, AI providers, third-party APIs
7. **Frontend stack** — if applicable (framework, styling, state management)
8. **Testing stack** — test runner, e2e tool, fixtures approach
9. **CI/CD** — what runs on PR, what runs on merge, where do builds go
10. **Observability** — logging, metrics, error tracking
11. **Local dev** — how does someone run this locally? (Docker? `npm run dev`?)
12. **Repo layout** — monorepo / polyrepo / single package
13. **Code style** — formatter, linter, any non-defaults
14. **Hard constraints** — anything from the PRD that locks a choice (e.g., "must run on-prem")

After all answers, write `docs/tech-spec.md` with one section per question. Use absolute names ("PostgreSQL 16," "Node 22") not vague terms.

Confirm with the user before exiting.

## Rules

- Default to boring, well-known tech unless the user has a reason for something exotic.
- If the user is unsure about a choice, recommend a default and note the tradeoff in one sentence.
- Surface conflicts with the PRD (e.g., "you wrote 'must work offline' but chose a hosted-only DB"). Halt and resolve before writing.
