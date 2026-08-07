---
description: Propose project-specific skills and write them to .claude/skills/
---

Read `docs/PRD.md` and `docs/tech-spec.md`. Based on those, propose project-specific skills the agent will need throughout the build.

## What a skill is in this project

A focused capability the agent should be able to invoke during work — e.g., "add a database migration in this stack," "wire a new API route," "run the test suite," "deploy a preview." Each skill is a markdown file at `.claude/skills/<name>.md` containing instructions specific to THIS project's stack.

## Process

1. Draft a candidate list (5-12 skills) based on the tech spec. Examples that often apply:
   - `run-tests.md` — running the test suite locally and in CI
   - `add-migration.md` — adding a database migration
   - `add-api-route.md` — adding an API endpoint
   - `add-component.md` — adding a UI component
   - `deploy-preview.md` — spinning up a preview environment
   - `seed-data.md` — loading fixture / seed data
   - `debug-prod.md` — accessing prod logs / metrics

2. Present the list to the user. Ask which to keep, drop, or add.

3. For each approved skill, write `.claude/skills/<name>.md` containing:
   - Title
   - When to use this skill
   - Step-by-step instructions specific to this project's stack
   - Common pitfalls

4. Write `.claude/skills/INDEX.md` listing every skill with a one-line description.

## Rules

- Skills must be specific to this project. "Run tests" should say `pnpm test --filter web`, not "run your test command."
- If you don't know the exact command for a skill, leave a `TODO:` and ask the user before exiting.
- Do not duplicate content from `.claude/rules/`. Skills are *how-to* for a stack; rules are *constraints* on the work.
