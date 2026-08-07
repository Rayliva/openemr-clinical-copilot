---
description: Walk a continuation build (e.g. Week 2) through PRD → tech spec → skills → rules → build loop, reusing existing artifacts and applying the phase-prefix convention
---

Run the **continuation** bootstrap workflow — for adding a new phase/week of work onto an
**existing** project, not a greenfield start. Unlike `/bootstrap`, this assumes a PRD, tech
spec, rules, and skills already exist from prior phases; it **builds on them and never
clobbers them**.

**Phase slug.** Use `$ARGUMENTS` as the phase slug (e.g. `w2`). If it is empty, ask the user
for it before doing anything else. Below, `<slug>` = lowercase form (`w2`) and `<SLUG>` =
uppercase form (`W2`).

Between phases, summarize what you produced and get the user's approval before moving on.

## Phase 0 — Inventory (do this first, never skip)
Before producing anything, read and internalize what already exists, so you **extend rather
than duplicate**:
- The source of truth driving THIS phase (the assignment/spec). For Week 2 that is repo-root
  `Week_2_AgentForge.pdf` plus the status board `docs/week2-requirements.html`.
- `docs/<slug>-brief.md` if it exists (e.g. `docs/w2-brief.md`) — the crystallized plan +
  already-locked tech/architecture decisions. **Treat these as settled** — build on them, do
  not re-derive. The companion `docs/<slug>-architecture-defense.html` deck holds the same
  decisions visually.
- Existing planning docs: `docs/PRD.md`, `docs/tech-spec.md`, `docs/build-loop.md`.
- Every file in `.claude/rules/`.
- `.claude/skills/INDEX.md`, then skim each `.claude/skills/*/SKILL.md`.
- The week-scoping convention: `CLAUDE.md` + memory `week-scoping-convention` — follow it for
  every output.
- Relevant memory: `slice-status`, `week2-requirements-tracker`, `copilot-project`.

Then state a one-screen summary: **what already covers this phase's needs vs. what is
genuinely new.** That gap list drives every phase below — do not re-derive settled decisions.

## Phase-prefix convention (apply to every output)
New continuation artifacts carry the `<slug>` marker; prior-phase artifacts are left
untouched. Anything unmarked = the baseline phase. (Canonical statement lives in `CLAUDE.md`
/ memory `week-scoping-convention`; this table is the operational shorthand.)

| Phase | Prior-phase file — LEAVE ALONE | This phase writes |
|---|---|---|
| PRD | `docs/PRD.md` | `docs/<slug>-PRD.md` |
| Tech spec / arch | `docs/tech-spec.md` | the assignment-mandated arch doc if one is named — Week 2: **`<SLUG>_ARCHITECTURE.md` at repo root** — else `docs/<slug>-tech-spec.md` |
| Build loop | `docs/build-loop.md` | `docs/<slug>-build-loop.md` |
| Skills | existing `.claude/skills/*` | new `<slug>-*` skills **beside** them (additive) |
| Rules | existing `.claude/rules/*` | new `<slug>-*` rules **beside** them (additive) |
| Specs | `docs/specs/*` | `docs/specs/<slug>-*.md` |
| CLAUDE.md | — | **extend only** — never regenerate |

## Phases
Follow each named command's *procedure*, but with the continuation overrides noted:

1. **PRD** — follow `.claude/commands/prd.md`. Input = this phase's source doc (+ the existing
   `docs/PRD.md` for continuity). Output = `docs/<slug>-PRD.md`. Scope it to the NEW work;
   reference the baseline PRD instead of restating it.
2. **Tech spec / architecture** — follow `.claude/commands/tech-interview.md`. Output = the
   mandated arch doc (`<SLUG>_ARCHITECTURE.md`) or `docs/<slug>-tech-spec.md`. Explicitly note
   which prior-phase stack decisions carry over unchanged, and interview ONLY on genuinely new
   choices (this phase's new components). Include everything the assignment requires that doc
   to contain (for Week 2: ingestion flow, worker graph, RAG design, eval gate, risks,
   tradeoffs, testing strategy, failure modes).
3. **Skills** — follow `.claude/commands/scaffold-skills.md`, but FIRST list the existing
   skills from Phase 0. For each capability the new work needs, decide: **reuse** an existing
   skill if it already covers it, **extend** one if it is close, or **add** a new `<slug>-*`
   skill only if genuinely new. Never duplicate an existing skill. Update
   `.claude/skills/INDEX.md` with any additions.
4. **Rules** — follow `.claude/commands/scaffold-rules.md`, but FIRST list existing rules. Add
   a rule only if the new work introduces a constraint not already covered; name new files
   `<slug>-*`. Prefer extending an existing rule in place when that is cleaner than a new file.
   Keep the CLAUDE.md rules enumeration current.
5. **Required rules check** — confirm `.claude/rules/spec-driven-development.md` and
   `.claude/rules/test-driven-development.md` still exist; they govern every phase.
6. **Build loop** — follow `.claude/commands/pick-loop.md`. Output = `docs/<slug>-build-loop.md`.
   Reuse the prior loop choice unless the new work argues for a different one; if it differs,
   say why.

Stop after step 6. Summarize every artifact written (with its `<slug>` path), **confirm no
prior-phase artifact was overwritten**, and tell the user they can run `/build` (pointed at
`docs/<slug>-build-loop.md`) when ready.

## Guardrails
- **Never overwrite a prior-phase (baseline) artifact.** If a target already exists from THIS
  phase, update it; if it is a baseline file, stop and ask.
- **Additive skills/rules only** — reuse/extend first, add last; no duplicates.
- **Do not regenerate `CLAUDE.md`** — extend it.
- These phases write files. Pause for approval between phases, and follow the project's
  ask-before-commit posture (memory `ask-before-commit-push-deploy`).
