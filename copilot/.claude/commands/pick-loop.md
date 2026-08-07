---
description: Select a build loop strategy and write docs/build-loop.md
---

Help the user choose a build loop. Present the options below, get a choice, then write the chosen loop's full operating procedure to `docs/build-loop.md`.

## Options

### 1. BMAD (Breakthrough Method for Agile AI-Driven Development)
Numbered, phased agents (Analyst → PM → Architect → Scrum Master → Dev → QA). Each phase has a specific role; outputs hand off to the next.

- **Best for:** larger projects with many features where role separation helps.
- **Cost:** more ceremony, more tokens, slower per feature.

### 2. Ralph loop
A single prompt re-run repeatedly until the agent declares the task done.

- **Best for:** focused, well-specified tasks; long-running autonomous builds.
- **Cost:** needs a *very* good base prompt and clear stopping criteria. Spins if specs are vague.

### 3. TDD loop
Pick a spec → write failing test → implement → green → refactor → next spec.

- **Best for:** projects where behavior is testable and specs are concrete.
- **Cost:** slower for UI / exploratory work; demands real test infrastructure up front.

### 4. Manual / human-driven
No loop. The human picks the next task each time.

- **Best for:** solo projects, exploration, learning.
- **Cost:** no autonomy; you are the scheduler.

## Process

1. Show the user the four options with one-line summaries.
2. Recommend one based on the PRD (e.g., recommend TDD if success metrics are well-defined; recommend manual if scope is exploratory). State your reasoning in one sentence.
3. Let the user choose.
4. Write `docs/build-loop.md` containing the chosen loop's full operating procedure: what the agent does on each iteration, what the stopping condition is, and how to handle failure. Be concrete — include the exact loop body, not just a description.
5. Update `CLAUDE.md` to reference `docs/build-loop.md` as the project's build procedure.

## Rules

- Do not pick the loop for the user — recommend, then let them choose.
- The chosen loop is not permanent. The user can re-run `/pick-loop` to switch.
