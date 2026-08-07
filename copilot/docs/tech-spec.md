# Tech Spec — Clinical Co-Pilot

> **Grounded in:** `docs/PRD.md` and the repo-root source docs (`../AUDIT.md`,
> `../USERS.md`, `../ARCHITECTURE.md`). Most of the stack is **locked** by those
> docs; this spec records the locked choices in absolute terms and resolves the
> technical gaps they left open (orchestration, OpenEMR auth grant, CI/deploy,
> toolchain defaults). Where this spec and the three docs disagree, **the docs
> win**.
>
> **Overarching design principle — build for unknown extension.** This project is
> under active development for ~3 weeks and will grow in directions not yet known
> (post-MVP: chart writes with approval gates, more use cases, more tools). Every
> choice below favors clean seams and extensibility over the smallest thing that
> ships the MVP. See §2 (LangGraph) and §14.

## 1. Language & runtime

- **TypeScript 5.x**, `strict: true`, on **Node.js 22 LTS** ("Jod").
- **ESM** modules (`"type": "module"`), `moduleResolution: "bundler"`/`nodenext`.
- **Package manager: pnpm 9.** Workspace-aware for the monorepo (`copilot/`).
- Clinical logic lives **only** in this TS service — never in OpenEMR PHP
  (`../ARCHITECTURE.md` core decision).

## 2. Frameworks

**Agent Service**
- **Fastify 5** — HTTP + **SSE streaming** (`/chat`). Chosen for speed and a small,
  typed plugin surface.
- **Vercel AI SDK** (`ai` + `@ai-sdk/anthropic`) — Claude streaming + tool-calling.
  - **Model tiering:** Claude **Sonnet** default (routing, most turns, the grounding
    judge); **Opus** reserved for hard synthesis (`../ARCHITECTURE.md §5`). Model IDs
    resolved at build time; default `claude-sonnet-5`, escalation `claude-opus-4-8`.
- **Zod** — the single source of truth for **every** tool input/output contract,
  exported to **JSON Schema** for the LLM tool definitions. Also used to validate
  model output; malformed output → bounded retry → degrade (`PRD` #7).
- **LangGraph.js** — the agent graph (assemble → generate → cite-check →
  ground-check → constraint-engine → bounded-retry → degrade). Chosen over a
  hand-rolled state machine **for future-proofing** (native branching/cyclic
  graphs, human-in-the-loop `interrupt` for the post-MVP write-approval flow,
  durable checkpoints, and a standard structure new contributors already know).
  - **Hard constraint — orchestrator-only rule:** LangGraph nodes are *thin
    wrappers*. Tools, the Context Assembler, and all three verification layers are
    **framework-agnostic pure modules** with their own types and unit tests. If
    LangGraph ever disappoints, we swap the shell, not the logic. This keeps
    safety-critical code independent of framework churn.

**OpenEMR module** (thin — no clinical logic):
`interface/modules/custom_modules/oe-module-copilot/`. PHP glue (module
registration + the `GET /copilot/session-token` bridge) following repo-root
`CLAUDE.md` house rules (PHP 8.2, `declare(strict_types=1)`, PSR-4, constructor DI,
`QueryUtils`). See §7 for its front-end widget.

## 3. Data layer

- **OpenEMR MySQL** — system of record. The agent **never** connects to it
  directly; all reads go through the OpenEMR FHIR/REST API (§5/§6).
- **Redis 7** — the **Patient Snapshot** cache (`../ARCHITECTURE.md §2.3`). Keyed by
  `pid` + version; **TTL-based invalidation in v1**; OpenEMR domain-event-driven
  invalidation is designed-for but **deferred** past v1 (PRD open question). Client:
  **ioredis**.
- **Langfuse Postgres** — backing store for self-hosted Langfuse only (not app
  data).
- **No search engine / queue in v1.** The huddle precompute runs inline; a queue is
  a documented later-tier scaling step (`../ARCHITECTURE.md §9`), and the graph is
  structured so it can move off the request path without a rewrite.
- **Provenance** is a first-class field on every assembled fact:
  `{source_table, row_uuid, fetched_at}`.

## 4. Hosting / deployment

- **DigitalOcean, one VM, one Docker Compose project** (`../ARCHITECTURE.md §8`).
  Services: `openemr`, `mysql`, `redis`, `agent`, `langfuse`, `langfuse-db`,
  **Caddy** (automatic TLS reverse proxy). A working `deploy/` stack + deployed fork
  already exist to build on.
- **Same infra MVP → final** — commit now, don't re-platform. Compose boundaries
  drawn so the agent container could later move to a managed host without violating
  "same infra."
- **Deploy mechanism:** manual, operator-driven — `git pull` + `docker compose up
  -d` on the VM (or an equivalent scripted step). **No CI/CD pipeline in v1**
  (§9). **Claude must always ask the user before committing, pushing, or
  deploying.**

## 5. Auth

Two distinct trust boundaries (`../ARCHITECTURE.md §3`):

- **Boundary #1 — Browser/OpenEMR → Agent Service.** The module's identity bridge
  mints a **short-lived (~5 min) HMAC-signed token** `{user_id, pid,
  correlation_id, exp}`, **only for a `pid` the logged-in user owns**
  (`patient_data.providerID` match). Signed with a shared secret from the agent's
  env (never stored in the OpenEMR DB). The Agent Service re-verifies signature +
  ownership on every request. This is the row-level authz OpenEMR lacks
  (`../AUDIT.md §1.1`).
- **Boundary #2 — Agent Service → OpenEMR API.** A **confidential OAuth2 client**
  using the SMART **backend-services** flow: **`client_credentials` grant with
  `private_key_jwt`** (asymmetric key assertion), **system read scopes**
  (`system/Patient.read`, `system/Condition.read`, `system/MedicationRequest.read`,
  `system/AllergyIntolerance.read`, `system/Observation.read`,
  `system/Encounter.read`). **Not** the password grant (`../AUDIT.md §1.3`).
  - **Honest limitation:** this token is role-level/system-wide at the OpenEMR layer
    (`../AUDIT.md §1.1`). Compensated *above*: the agent only ever queries the single
    `pid` from the boundary-#1 token. Documented, not hidden. **Prerequisite:**
    register the client — `oauth_clients` is currently empty.
- **Boundary #3 — Agent Service → Claude.** BAA assumed; **minimum-necessary**
  fields only (never whole charts, never bulk `$export`); correlation ID attached.

## 6. External services

- **Anthropic Claude** via Vercel AI SDK (Sonnet + Opus). Only external PHI-touching
  service in the request path; BAA assumed, synthetic data only.
- **OpenEMR FHIR/REST API** — the read path (§5 boundary #2). US Core R4 resources:
  `Patient`, `Condition`, `MedicationRequest`, `AllergyIntolerance`, `Observation`,
  `Encounter`, plus `openemr_postcalendar_events` (today's schedule for provider 6,
  UC-1) via the REST surface.
- **Langfuse (self-hosted)** — tracing/observability, in-boundary (§10).
- No payments/email/analytics in v1.

## 7. Frontend stack

- **Agent-side:** none beyond SSE — the agent streams tokens + inline citations.
- **OpenEMR module widget:** a **small React 18 + TypeScript** chat panel, built
  with **Vite**, output as **static JS/CSS assets** served by the OpenEMR module
  and embedded in the patient chart (`interface/patient_file/summary/…`) plus a
  morning-huddle view over the day's schedule. Talks to the Agent Service over SSE
  using the boundary-#1 token. Styling: lightweight (CSS modules / minimal
  utility CSS) to sit inside OpenEMR's existing chrome without a heavy design
  system. No global state library needed at this size (React state + a small SSE
  hook).

## 8. Testing stack

- **Vitest** — unit + integration tests. **TDD is mandatory** (`.claude/rules/
  test-driven-development.md`): red → green → refactor per behavior. The pure
  modules (tools, Context Assembler, reconciliation, all three verification layers)
  are unit-tested directly; boundaries (OpenEMR API, Redis, Claude) are mocked at
  the HTTP/driver seam, not internally.
- **promptfoo** — the eval harness, using **seed data as ground truth**
  (`../ARCHITECTURE.md §7`). Cases cover the invariants/boundaries/safety scenarios
  from the PRD: citation invariant, empty-chart (absence≠"all clear"), med-source
  conflict, allergy-without-severity, authorization refusal (non-owned pid),
  injection refusal, penicillin-constraint flag. Safety-critical cases must pass
  **100%**.
- **e2e:** a thin **Playwright** smoke over the `/chat` SSE flow for the critical
  UC-1/UC-2 path (at least once per critical flow, per the TDD rule). Optional if
  time-constrained; the promptfoo + Vitest layers carry the behavioral load.
- **Fixtures:** the seed dataset is the shared fixture; Snapshot fixtures are
  recorded from it for deterministic verification-layer tests.

## 9. CI/CD

- **No CI pipeline in v1** — explicit user decision (2026-07-08). GitLab remains the
  single source of truth for code.
- Quality gates (lint, typecheck, `vitest`, `promptfoo`) are run **locally / on
  demand** rather than in a pipeline.
- **Deploy is manual and operator-driven** (§4). **Claude asks before every
  commit, push, and deploy.**
- Structured so a GitLab CI pipeline (checks on MR, optional deploy on merge) can be
  added later without rework, if the user asks.

## 10. Observability

- **Self-hosted Langfuse (+ its Postgres)** — traces (span per graph node: latency,
  tokens, cost). Self-hosted so PHI-bearing traces never leave the trust boundary
  (`../AUDIT.md §5`, `../ARCHITECTURE.md §2.6`).
- **Correlation ID** minted at the bridge, carried on every log line, tool call, and
  LLM request. **Structured JSON logs** (pino).
- **`/health`** (liveness, cheap) and **`/ready`** (real dependency checks:
  OpenEMR API + Claude + Redis + Langfuse reachable) are **distinct**.
- **Dashboard:** request count, error rate, p50/p95/p99 latency, tool-call counts,
  retries, **verification pass/fail rate**.
- **≥3 alerts** each with a documented response: p95 latency over threshold; error
  rate over threshold; tool-failure rate over threshold.
- **Agent's own append-only disclosure log** for PHI reads, independent of
  OpenEMR's forgeable `log`/`api_log` (`../AUDIT.md §5.1`).

## 11. Local dev

- **Docker Compose** — the same compose project as deploy (§4) runs locally
  (openemr, mysql, redis, agent, langfuse, langfuse-db, Caddy). OpenEMR itself uses
  the repo's existing `docker/development-easy` stack + `openemr-cmd` tooling (see
  repo-root `CLAUDE.md`).
- **Agent iteration:** `pnpm dev` (tsx/vite watch) against the Compose-provided
  Redis + OpenEMR API.
- **Seed:** a scripted step (`pnpm seed` or a compose one-shot) loads the curated
  dataset — required because the stock demo (3 patients, 2014 dates, no labs) can't
  demo a clinic day and is also the eval ground truth.
- **Secrets** via `.env` (HMAC bridge secret, OAuth2 private key, Anthropic key,
  Langfuse keys) — never committed; synthetic data only.

## 12. Repo layout

- **Monorepo.** The sidecar lives under **`copilot/`**; the thin PHP module lives in
  the monolith at `interface/modules/custom_modules/oe-module-copilot/`.
- Inside `copilot/`, a pnpm workspace separates concerns to keep future extension
  clean, e.g.:
  - `apps/agent` — the Fastify service + LangGraph graph.
  - `packages/tools` — Zod-contracted tools (pure).
  - `packages/verification` — the three verification layers (pure).
  - `packages/snapshot` — Context Assembler + reconciliation (pure).
  - `packages/openemr-client` — OAuth2 + FHIR read client.
  - `evals/` — promptfoo cases + Vitest suites.
  - (Exact package boundaries finalized during scaffolding; the pure-vs-shell split
    is the invariant.)
- **GitLab is the single source of truth**; commit real artifacts only, deploy only
  committed files.

## 13. Code style

- **ESLint** (typescript-eslint, recommended-type-checked) + **Prettier** (repo
  default config). TypeScript `strict`.
- **Zod-first contracts**, no `any` at boundaries; narrow, don't cast.
- Errors: catch at boundaries only where recovery is meaningful; never expose raw
  internal errors to the user-facing chat; structured logging with context objects,
  not string interpolation (mirrors the repo-root PHP standards in spirit).

## 14. Hard constraints (locked by the PRD / source docs)

- **Separate TS sidecar; clinical logic never in PHP.**
- **Authorization enforced above OpenEMR** (boundary #1 per-owned-patient minting;
  agent self-restricts to one `pid`).
- **Read-only agent (v1)** — no chart writes, no diagnosis, no prescribing, no
  ungrounded medical Q&A, no cross-patient access, no unsourced claims.
- **Read via scoped OAuth2 FHIR/REST** — not direct DB, not new PHP read endpoints.
- **Trust engineered** — provenance on every fact; answer only from tool output;
  three-layer verification gate; graceful degradation, never silent failure. The
  **clinical-constraint engine is deterministic** on structured facts, never prose.
- **Speed structural** — precomputed reconciled Snapshot in Redis; tiered response;
  streaming; Sonnet default / Opus only for hard synthesis. Targets: fast-path p95
  <3s first token / <8s full; >80% cache hit-rate (PRD success metrics).
- **PHI stays in-boundary** — synthetic data only; assumed BAAs; self-hosted
  Langfuse; minimum-necessary to Claude.
- **DO one-VM Docker Compose; same infra MVP→final.**
- **Build for unknown extension** — favor extensibility (LangGraph, workspace
  package seams, pure-module core) over minimal-to-ship; ~3-week active dev horizon.
- **Timeline:** MVP Fri 2026-07-10 · Early Sat 2026-07-11 · Final Sun 2026-07-12.
- **Process:** Claude asks before every commit, push, and deploy.
