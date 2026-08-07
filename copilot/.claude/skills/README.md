# Skills

Per-project skills for the Clinical Co-Pilot. Each skill lives at
`<name>/SKILL.md` and describes how to do one specific kind of work in this
project's stack.

These are **project skills**: committed to the repo, available to anyone who
clones it, and scoped to this directory. They are discovered only when Claude
Code runs with `copilot/` as its working directory (see `../../CLAUDE.md`).
Nothing here belongs in personal skills (`~/.claude/skills/`) — every one of
them references this stack.

## Format

Claude Code discovers a skill by its YAML frontmatter. A flat `<name>.md` with
no frontmatter is invisible.

```markdown
---
name: add-tool
description: Add a new capability the agent can call ... Use when <trigger>, <trigger>.
---

# Skill: add-tool
...
```

The `description` is the only part always in context — it is what the agent
matches against to decide whether to load the body. Write it with concrete
trigger conditions, not a topic label.

## Adding one

1. `mkdir <name>` and write `<name>/SKILL.md` with the frontmatter above.
2. Add a row to `INDEX.md`.
3. Start a fresh session and confirm the skill appears in the skill list.
