We are going to start a new project. The concept of the project is this:

A **Clinical Co-Pilot** — a conversational AI agent that helps one primary-care
physician, Dr. Donna Lee (`users.id = 6` in this OpenEMR install), get patient
context fast and safely during her clinic day. It runs as a **separate sidecar
service alongside the OpenEMR fork in this repo — it is NOT integrated into
OpenEMR's PHP codebase.** OpenEMR stays the system of record; the agent does the
reasoning; a thin OpenEMR module supplies only a chat UI and an identity bridge.

The agent serves four use cases, all read-only (it surfaces and reconciles
existing data — it never diagnoses, prescribes, or writes to the chart):
- **UC-1 (flagship):** the 8:50am morning pre-visit huddle — for each patient on
  today's schedule, "what changed since last visit / what needs attention today."
- **UC-2:** the 90-second pre-appointment patient update, with grounded follow-ups.
- **UC-3:** medication reconciliation across OpenEMR's disagreeing sources
  (`lists` vs `prescriptions`), surfacing conflicts instead of silently picking one.
- **UC-4:** a pre-action safety surface (documented allergies, med-status conflicts,
  duplicate therapy, renal flags) — decision support by retrieval, not decision making.

Three things define the design and must be honored:
1. **Authorization is enforced above OpenEMR, because OpenEMR can't.** Its ACL is
   role-level, not patient-level, so the OpenEMR module mints a short-lived signed
   token only for a patient Donna actually owns (`patient_data.providerID = 6`), and
   the agent re-checks that binding and only ever queries that one patient.
2. **Trust is engineered.** Every tool returns facts tagged with provenance (source
   table + row uuid); the agent answers only from tool output; and every response
   passes a verification gate before display — a deterministic citation check, a
   semantic grounding check (LLM-judge), and a deterministic clinical-constraint
   engine (allergy/interaction/renal/duplicate-therapy) that runs on structured
   facts, never on prose. Failures degrade gracefully ("I can't confirm X"), never
   silently.
3. **Speed is structural.** A provenance-tagged, reconciled Patient Snapshot is
   precomputed and cached in Redis so the fast-path use cases answer from memory;
   deep tools fire only when asked; responses stream. Demo data must be seeded (the
   stock demo is 3 patients, all appts dated 2014, no labs) — the seed doubles as
   eval ground truth.

**The full plan already exists and is committed at the repo root — treat these as
the source of truth and required reading before drafting anything:**
- `../AUDIT.md` — OpenEMR findings that constrain the agent.
- `../USERS.md` — the user and use cases UC-1…UC-4 (every capability must trace here).
- `../ARCHITECTURE.md` — the agreed architecture, trust boundaries, data-access
  decision, verification gate, observability, deploy, evals, and cost analysis.

I know this about the tech stack (these are locked decisions — confirm and record
them, don't re-open them without a reason):
- **Agent service:** TypeScript / Node on **Fastify** (HTTP + SSE streaming).
- **LLM orchestration:** **Vercel AI SDK** (Claude — Sonnet default, Opus for hard
  synthesis), **Zod** for every tool input/output contract (single source of truth,
  exported as JSON Schema for tool defs), **LangGraph.js** (or a hand-rolled state
  machine) so verification/retry/degradation is code, not prompt.
- **Data access:** read OpenEMR via its **REST/FHIR API with a scoped OAuth2
  client** (not direct DB, not new PHP endpoints); reconcile + assemble provenance
  in TypeScript.
- **Cache:** **Redis** for the Patient Snapshot.
- **Observability:** **self-hosted Langfuse** (+ its Postgres) so PHI-bearing traces
  stay inside the trust boundary; correlation ID minted at the bridge threads every
  log/tool/LLM call; structured JSON logs; `/health` and `/ready` (real dependency
  checks); ≥3 alerts.
- **Evals:** **promptfoo + a Vitest suite**, using the seed data as ground truth.
- **OpenEMR module:** a thin `interface/modules/custom_modules/oe-module-copilot/`
  (chat panel + `GET /copilot/session-token` identity bridge). Small TS/React widget.
- **Deploy:** **DigitalOcean, one VM, one Docker Compose project** (openemr, mysql,
  redis, agent, langfuse, langfuse-db, Caddy TLS). Same infra MVP → final. There is
  already a working `deploy/` stack and a deployed fork to build on.
- **Repo:** the sidecar lives in this same repo under `copilot/` (monorepo).

Now before you write any code, let's plan in great detail the architecture, tech
stack, and business logic following the commands, rules, and skills outlined in
CLAUDE.md. Start with `/bootstrap`. Because `../AUDIT.md`, `../USERS.md`, and
`../ARCHITECTURE.md` already settle most of the PRD and tech-spec, ground those
documents in them and interview me only to fill genuine gaps — do not re-derive
decisions that are already made.
