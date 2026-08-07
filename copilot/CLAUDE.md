# Project conventions — Clinical Co-Pilot (sidecar)

This directory (`copilot/`) is the project root for the **Clinical Co-Pilot**: a
standalone agent service that assists a physician using the OpenEMR fork this repo
contains. It was bootstrapped from the greenfield template. Follow these rules
during all work **inside `copilot/`**.

> **This is a sidecar, not a monolith change.** The agent is a separate service
> (see the tech spec once written). It is *not* integrated into OpenEMR's PHP
> codebase. The only footprint inside the monolith is a thin OpenEMR module (chat
> UI + identity bridge). Keep clinical logic out of PHP. Integration into the
> monolith is a possible *future* direction — design for it, don't do it now.

## Two CLAUDE.md files — know which applies

- Work under `copilot/` → **this file** governs (the sidecar).
- Work anywhere else in the repo (the OpenEMR monolith, `interface/`, `library/`,
  `deploy/`, the thin `oe-module-copilot` PHP module) → the **repo-root
  `CLAUDE.md`** governs (PHP 8.2, PSR-4, PHPStan level 10, `openemr-cmd`, etc.).

When Claude Code is started with its working directory at the repo root, the
`copilot/` slash commands and skills below are **not** auto-discovered. Start
Claude Code with `copilot/` as the working directory to run this workflow.

## The plan already exists — build on it, don't re-derive it

Three planning docs are committed at the **repo root** and are the source of truth
for what we're building.

`../USERS.md` is imported below, so it is always in context. The other two are
large; load them when the work touches them:

- `../AUDIT.md` — what OpenEMR does and where it will bite an agent (authz is
  role-level not row-level; every read is audit-amplified; meds disagree across
  `lists`+`prescriptions`; ICD-9 codes; demo data is thin and misleading). The
  **`openemr-gotchas` skill** distills this and loads on demand; read the full doc
  for file/line references.
- `../ARCHITECTURE.md` — the agreed agent architecture (separate TS service,
  authZ above OpenEMR, provenance-tagged Patient Snapshot cached in Redis,
  verification gate, self-hosted Langfuse, DO Compose deploy). The
  **`architecture-decisions` skill** carries the locked decisions and the
  *rejected alternatives* and loads on demand; read the full doc for the
  system-context diagram and section detail.

@../USERS.md

`/bootstrap` produces `docs/PRD.md` and `docs/tech-spec.md`. Those must be
**grounded in the three docs above** — interview only to fill genuine gaps, do not
re-litigate settled decisions.

**`docs/week1-requirements.md` is the Week 1 graded-requirements tracker — READ IT before
planning any work.** It lists every Week 1 assignment requirement (agentic chatbot,
verification incl. domain-constraint enforcement, observability, evals, the
engineering + submission deliverables) with a live status column. Every slice must
advance one or more toward done; keep the statuses current as work lands. Current
build progress is also in memory `slice-status`.

**`docs/week2-requirements.html` is the Week 2 graded-requirements tracker (source:
repo-root `Week_2_AgentForge.pdf`) — READ IT before planning any Week 2 work.** It is
a self-contained HTML board covering every Week 2 requirement (multimodal document
ingestion of a lab PDF + intake form, hybrid RAG + rerank, supervisor + intake-extractor
/ evidence-retriever workers, the 50-case boolean-rubric eval CI hard gate, the citation
contract + PDF bounding-box overlay, and all engineering/submission deliverables) with a
red/amber/green status per item. **Whenever a Week 2 feature lands, update that file**:
flip the matching card's `data-status` (`red`→`amber`→`green`), refresh its `note`, and
bump the `#updated` date — the header totals + progress bar recompute themselves from the
`data-status` values. Green means done *and* verified on disk/live, never "code exists."
See memory `week2-requirements-tracker`.

**Week-scoping convention (avoid W1/W2 confusion).** Separate the two weeks at the
*tracking + naming* layer, not the code: Week 2 compounds Week 1's shared packages, so
the code stays one unified, additive monorepo (new Week 2 work lands as new
`packages/*`/graph nodes beside the old — do **not** fork `packages-week1/` etc., and do
not archive Week 1, which the Week 2 "extend X" items depend on). Instead:
- **`W2` / `w2-` marker on every *new* Week 2 artifact; anything unmarked = Week 1
  baseline.** Repo-root arch doc is `W2_ARCHITECTURE.md` (beside Week 1's
  `ARCHITECTURE.md`); Week 2 specs are `docs/specs/w2-*.md`; the Week 2 golden-set eval
  cases are tagged `week:2` (one unified `evals/` suite — the CI gate runs everything;
  the safety subset stays 100%).
- **Two requirement boards, never merged:** Week 1 = `docs/week1-requirements.md`, Week 2 =
  `docs/week2-requirements.html`. Each Week 2 amber card names the Week 1 mechanism it
  extends — that cross-link is what keeps the foundation discoverable without merging.
- The README must **separate Week 1 baseline behavior from Week 2 multimodal behavior**
  (a graded submission requirement) — that's a doc section, not a directory split.

## Rules — auto-loaded, non-negotiable

Every file in `.claude/rules/` is loaded automatically at session start; you do not
need to open them. They are constraints on every change, summarized here:

- `.claude/rules/spec-driven-development.md` — write the spec before the code.
- `.claude/rules/test-driven-development.md` — red → green → refactor per behavior.
- `.claude/rules/authorization-and-pid-scope.md` — one bound `pid` per session; pid
  never from model/user input; refuse non-owned patients.
- `.claude/rules/provenance-and-grounding.md` — answer only from tool output; every
  claim cited with provenance; absence ≠ negative finding.
- `.claude/rules/verification-gate.md` — nothing user-facing bypasses the gate;
  constraint engine on structured facts only; degrade, never fail silently.
- `.claude/rules/orchestrator-only.md` — LangGraph nodes are thin wrappers; logic
  lives in pure `packages/*` modules.
- `.claude/rules/phi-and-secrets.md` — minimum-necessary to the LLM; PHI stays
  in-boundary; secrets env-only, never committed.
- `.claude/rules/error-handling-and-logging.md` — catch at boundaries only; never
  expose raw errors; structured logs with correlation ID, no interpolation.
- `.claude/rules/typescript-standards.md` — strict TS, Zod-first contracts, no
  `any` at boundaries, immutability, constructor DI.
- `.claude/rules/commit-and-deploy.md` — Conventional Commits; ask before every
  commit/push/deploy; deploy only committed files.

Week 2 adds three `w2-*` rules (additive; the above still all apply):
- `.claude/rules/w2-document-ingestion-writes.md` — schema is canonical (no raw-VLM
  bypass); sidecar never writes (module commits); no commit without physician confirm
  or without a citation; idempotent `derivedFrom`, no silent overwrite; extract once.
- `.claude/rules/w2-multi-agent-orchestration.md` — supervisor is not a black box
  (typed decision + logged rationale); workers thin over pure packages; safety core
  always runs; no worker path bypasses the gate; handoffs traced as child spans.
- `.claude/rules/w2-eval-gate.md` — the eval CI gate must demonstrably block a
  regression; boolean rubrics only; fail on >5% category regression; deterministic +
  offline (stubbed) checks; safety subset 100%; golden set reproducible from the repo.

One further rule governs the **optional** parallel-build mode (below); it constrains
every change only *when* the build loop fans out, and is inert during serial work:
- `.claude/rules/parallel-work-isolation.md` — parallel units are file-disjoint with
  explicit write scopes in `docs/work-manifest.md`; shared contracts are frozen +
  committed by the orchestrator before fan-out and are read-only to builders (a builder
  that finds a contract wrong stops and hands back, never edits it); builders work in
  isolated worktrees and return diffs; one integrator merges serially with the full
  suite green; the safety-critical core is never parallelized. **Sidecar (`copilot/`)
  TS work only** — PHP-module changes and the safety spine stay serial in the main tree.

## Skills

Per-project skills live in `.claude/skills/<name>/SKILL.md` and are **auto-discovered**
— each one's `description` is already in context, and the body loads on demand when a
task matches. Invoke one by name when it fits; don't re-derive its procedure.
`.claude/skills/INDEX.md` is a human-readable map of what exists.

Skills are *how-to*; rules are *constraints*. When adding a skill, follow
`.claude/skills/README.md` — flat `<name>.md` files are invisible to the agent.

## Workflow

If `docs/PRD.md` does not yet exist, run `/bootstrap` to walk through
PRD → tech spec → skills → rules → build-loop selection. Paste
`prompts/IDEA_READY.md` as the opening message to seed it.

Once bootstrap is complete, `docs/build-loop.md` defines the build procedure. Run
`/build` to execute it.

**Parallel build (optional).** Serial `/build` is the default. When a remaining chunk
genuinely decomposes into file-disjoint work, `/plan-work` decomposes the next chunk's
specs into `docs/work-manifest.md` (per-task write/read scopes, dependency-ordered
waves), and the **`builder`** agent implements exactly one manifest task TDD-first in an
isolated worktree, confined to that task's write scope, never editing a shared contract
(it hands back instead) and never merging. The orchestrator freezes/commits shared
contracts before fan-out and integrates builder diffs one at a time. See the "Parallel
mode (optional)" section of `docs/w2-build-loop.md` and
`.claude/rules/parallel-work-isolation.md`. **`copilot/` TS work only** — PHP-module and
safety-spine work stay serial.

**Starting a new phase/week on top of the existing build (e.g. Week 2)?** Do **not** re-run
`/bootstrap` (it is greenfield and assumes an empty project). Run `/bootstrap-continue <slug>`
(e.g. `/bootstrap-continue w2`) instead: it inventories the existing PRD/tech-spec/rules/skills
first, then walks the same PRD → tech spec → skills → rules → build-loop chain writing
phase-prefixed outputs (`docs/<slug>-PRD.md`, `<SLUG>_ARCHITECTURE.md`, new `<slug>-*`
skills/rules **beside** the existing ones) so nothing from the prior phase is overwritten. It
follows the week-scoping convention above.

## Project-specific notes

- **Repo hygiene:** GitLab is the single source of truth. Commit real artifacts;
  don't leave generated/untracked files scattered in the tree, and deploy only
  committed files.
- **Read-only agent (v1):** the agent surfaces and reconciles existing chart data;
  it never writes to the chart, diagnoses, or prescribes. See `../USERS.md`
  non-goals.
- **PHI:** synthetic/seed data only in this project. Keep PHI-bearing traces inside
  the trust boundary (self-hosted observability).

# Greenfield project template

A starting template for new Claude Code projects.

## What `/bootstrap` does

Walks the agent through the greenfield workflow:

1. `/prd` — interview the user and draft `docs/PRD.md`
2. `/tech-interview` — interview the user about the stack and draft `docs/tech-spec.md`
3. `/scaffold-skills` — propose and write per-project skills to `.claude/skills/`
4. `/scaffold-rules` — propose and write project-specific rules to `.claude/rules/`
5. The required rules `spec-driven-development.md` and `test-driven-development.md` ship with the template
6. `/pick-loop` — choose a build loop (BMAD, ralph, TDD, or manual) and write `docs/build-loop.md`
7. `/build` — execute the chosen loop

Each step can also be run individually.

## Layout

```
copilot/
  .claude/
    commands/   slash commands defining the workflow
    skills/     per-project capabilities (filled by /scaffold-skills)
    rules/      methodology + project-specific rules (the two required ones ship here)
  docs/         PRD.md, tech-spec.md, build-loop.md (produced by /bootstrap)
  prompts/      IDEA_READY.md — the seed prompt for /bootstrap
  CLAUDE.md     this file, loaded automatically when working under copilot/
```
