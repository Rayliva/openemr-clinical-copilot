# PRD — Clinical Co-Pilot

> **Status:** v1 scope, bootstrap phase.
> **Grounded in:** `../AUDIT.md`, `../USERS.md`, `../ARCHITECTURE.md` (repo-root
> source-of-truth docs). This PRD does not re-derive decisions settled there; it
> restates them in product terms and fills the gaps those docs left open
> (concrete success metrics, calendar dates). Where this PRD and the three docs
> ever disagree, **the three docs win** and this PRD is corrected.

## Summary

The Clinical Co-Pilot is a conversational AI agent that helps **one** primary-care
physician — Dr. Donna Lee (`users.id = 6` in this OpenEMR install) — get patient
context **fast** and **safely** during her clinic day. It runs as a **separate
TypeScript sidecar service** alongside the OpenEMR fork in this repo; OpenEMR
remains the system of record and the agent does the reasoning. A thin OpenEMR
module supplies only a chat UI and an identity bridge. The agent is **read-only**:
it surfaces and reconciles existing chart data, with every claim traceable to a
source, and never diagnoses, prescribes, or writes to the chart. It serves four
use cases — a morning pre-visit huddle (UC-1, flagship), a 90-second
pre-appointment update (UC-2), medication reconciliation (UC-3), and a pre-action
safety surface (UC-4) — all traceable to `../USERS.md`.

## Problem

Dr. Lee's patients' data is scattered across many OpenEMR tables joined by logical
`pid`/`encounter` (problems in `lists`, medications in **both** `lists` **and**
`prescriptions`, labs in `procedure_result`, vitals behind the `forms` registry).
Reassembling a mental picture of a patient means clicking through chart tabs every
single time, and three specific things make it hard and unsafe:

1. **"What changed since last visit" is not a view that exists.** She reconstructs
   it from raw notes and results on every patient, every day.
2. **Medication truth is ambiguous.** Her patient Susan Underwood's meds disagree
   across sources — 3 in `lists`, 1 in `prescriptions`, with a contradictory
   active/inactive status (`../AUDIT.md §4.1`). Reconciling by eye under time
   pressure is exactly where errors happen.
3. **Absence is dangerous.** Susan has no documented allergies and no labs on file
   — which reads as "nothing to worry about" when the truth is "we don't know."

She works in ~15–20 minute slots (~18–22 patients/day). The moments that matter
are the 8:50 AM huddle, the 90-second window between rooms, and the mid-visit
lookup she needs without breaking eye contact.

## Users / personas

**Primary (and only) user — Dr. Donna Lee, PCP.** `users.id = 6`, an `authorized`
provider; patients are assigned to her via `patient_data.providerID = 6`. In this
demo her panel is a single diabetes patient, Susan Underwood (pid 2). She is the
continuity owner — sees the same patients over years and is accountable for what
falls through the cracks between visits.

**Her non-negotiables** (these are product constraints, not nice-to-haves):
- **Speed:** answers in seconds, or she won't use it. A fast, partial,
  clearly-scoped answer beats a slow complete one.
- **Trust:** one confident hallucination and she abandons the tool permanently.
  Every claim must trace to her patient's actual record.
- **Safety framing:** surface what's documented and flag concerns; do not diagnose
  or prescribe.

**Scale (v1):** one concurrent user (Donna). The system is *designed* for later
tiers (100 / 1K / 10K / 100K users are cost-modeled in `../ARCHITECTURE.md §9`) but
v1 targets a single physician's clinic day. Deliberately narrow: one user, one
workflow, four defensible use cases.

## Goals & success metrics

The agent succeeds when Donna gets trustworthy patient context fast enough to use
between rooms, and never once sees a confident claim she can't trace. Concrete,
testable v1 targets:

| Metric | Target |
|---|---|
| Fast-path latency (UC-1/UC-2 from cached snapshot) — time to first token | p95 < 3s |
| Fast-path latency — full answer | p95 < 8s |
| Citation integrity | **100%** of clinical claims carry a valid source ref (deterministic citation-check pass); zero uncited clinical claims |
| Eval suite overall | ≥ 95% of cases pass |
| Eval suite — safety-critical cases | **100%** pass: authorization refusal (non-owned patient), prompt-injection refusal, allergy/clinical-constraint flags fire, absence reported as "no data on file" (never "all clear") |
| Snapshot cache hit-rate on fast-path turns | > 80% |

Supporting operational goals (from `../ARCHITECTURE.md §2.6`): a correlation ID
threads every log/tool/LLM call into a Langfuse trace; `/health` and `/ready` are
distinct, with `/ready` doing real dependency checks; ≥3 alerts (p95 latency,
error rate, tool-failure rate) each with a documented response.

## In-scope features (v1, prioritized)

1. **Seed dataset + eval ground truth (P0, prerequisite).** The stock demo (3
   patients, all appointments dated 2014, zero labs) cannot demo a clinic day. A
   seed script creates a realistic panel for Donna (target ~20 patients,
   today-dated appointments, deliberate inter-visit deltas, the Susan med-conflict
   preserved). Doubles as eval ground truth. (`../ARCHITECTURE.md` Summary.)
2. **Thin OpenEMR co-pilot module (P0).**
   `interface/modules/custom_modules/oe-module-copilot/` — (a) chat panel embedded
   in the patient chart + a morning-huddle view over the day's schedule; (b)
   identity bridge `GET /copilot/session-token` that mints a short-lived
   HMAC-signed `{user_id, pid, correlation_id, exp}` **only for a `pid` the user
   owns** (`providerID` match). This is where the row-level authz OpenEMR lacks is
   enforced (`../AUDIT.md §1.1`).
3. **Agent Service skeleton (P0).** Fastify (HTTP + SSE), `/health`, `/ready`,
   `/chat`; Vercel AI SDK (Claude); scoped OAuth2 client registered against
   OpenEMR (`oauth_clients` is currently empty).
4. **Context Assembler + Patient Snapshot (P0).** Reads via OpenEMR REST/FHIR,
   assembles a provenance-tagged snapshot (demographics, active problems,
   reconciled meds, allergies, recent labs/vitals/encounters, last-visit delta),
   cached in Redis. Every field carries `{source_table, row_uuid, fetched_at}`.
5. **UC-2 — pre-appointment update (P0).** Tight snapshot + grounded multi-turn
   follow-ups for the in-context patient, each cited.
6. **UC-1 — morning huddle (P0, flagship).** Per-patient "what changed + what to
   check" across today's schedule (provider 6), each line cited.
7. **Verification gate (P0).** (a) deterministic citation check, (b) semantic
   grounding check (LLM-judge on the cited source only), (c) deterministic
   clinical-constraint engine on structured facts (allergy/interaction/renal/
   duplicate-therapy). Failures degrade gracefully ("I can't confirm X"), never
   silently.
8. **UC-3 — medication reconciliation (P1).** Union `lists` + `prescriptions`,
   dedupe, surface conflicts with both sources cited; never silently pick one.
9. **UC-4 — pre-action safety surface (P1).** Combine allergies + problem list +
   reconciled meds against the constraint engine; surface documented flags with
   citations; explicit "no documented concerns found" when none exist.
10. **Observability (P0).** Self-hosted Langfuse (+ Postgres) inside the trust
    boundary; correlation IDs; structured JSON logs; dashboard (request count,
    error rate, p50/p95/p99, tool calls, retries, verification pass/fail rate);
    ≥3 alerts.
11. **Eval harness (P1).** promptfoo + Vitest against seed ground truth; the
    boundary/invariant/safety cases enumerated in `../ARCHITECTURE.md §7`.
12. **Deploy (P0).** DigitalOcean, one VM, one Docker Compose project (openemr,
    mysql, redis, agent, langfuse, langfuse-db, Caddy TLS). Same infra MVP→final.
    Runnable Postman/Bruno collection covering `/chat`, `/health`, `/ready`, and
    each tool endpoint.

## Out-of-scope (v1)

- **No diagnosis and no autonomous prescribing** — surfaces and flags; the
  clinician decides.
- **No writes to the chart** — read-only. Clinical documentation stays in
  OpenEMR's own workflows. (May become a use case post-MVP.)
- **No generic medical Q&A** ungrounded in this patient's record.
- **No access to patients outside Donna's authorization** — a request about a
  non-owned patient (e.g. pid 3) is refused, with the reason stated.
- **No stated claim without a source** — "I can't confirm that from the record" is
  a valid, expected answer.
- **Not integrated into OpenEMR's PHP codebase** — the only PHP footprint is the
  thin module (#2). Integration into the monolith is a possible *future* direction.
- **No hardening of OpenEMR's own audit/credential weaknesses** (`../AUDIT.md
  §1.2/§5.1`) beyond what the agent needs for its own disclosure log — those are
  documented as pre-production requirements, not v1 deliverables.

## Constraints

- **Architecture:** separate TypeScript/Node sidecar (Fastify + SSE); clinical
  logic never in PHP. Authorization enforced *above* OpenEMR (boundary #1).
- **Data access:** read OpenEMR via its REST/FHIR API with a **scoped OAuth2
  client** — not direct DB, not new PHP read endpoints. Reconciliation + provenance
  assembly happen in TypeScript.
- **PHI / compliance:** **synthetic/seed data only** in this project. Assumed BAAs
  with the LLM provider and any PHI-touching subprocessor; observability kept
  **self-hosted** (Langfuse) so PHI-bearing traces never leave the trust boundary
  (`../AUDIT.md §5`, `../ARCHITECTURE.md §2.6`). Minimum-necessary fields to the
  LLM — never whole charts, never bulk `$export`.
- **Deploy:** DigitalOcean, one VM, one Docker Compose project; same infra
  MVP→final (commit now, don't re-platform). A working `deploy/` stack and a
  deployed fork already exist to build on.
- **Repo:** monorepo — the sidecar lives under `copilot/`; GitLab is the single
  source of truth; deploy only committed files.
- **Timeline (compressed, 4 days):** today is **Wed 2026-07-08**.
  - **MVP — Fri 2026-07-10:** seed script; deployed OpenEMR fork on DO; agent
    skeleton (`/health`, `/ready`); OAuth2 client registered.
  - **Early — Sat 2026-07-11:** working UC-1/UC-2; verification layers 1–2;
    Langfuse traces + dashboard; correlation IDs; first eval cases.
  - **Final — Sun 2026-07-12:** UC-3/UC-4; constraint engine; full eval suite;
    load tests + baselines; alerts; cost analysis; API collection; demo.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Data quality misleads the agent** (`../AUDIT.md §4`): ICD-9 codes, med-source disagreement, empty charts, format drift, allergy with no severity, 2014-stale dates. **Top agent risk.** | Reconciliation (UC-3), provenance on every fact, "absence ≠ negative finding" sentinels, seeded ground truth, always show sources so Donna can judge, label stale/partial data explicitly. |
| **One hallucination loses the user forever.** | Three-layer verification gate; agent answers only from tool output; deterministic citation check + LLM-judge grounding + deterministic constraint engine; graceful degradation over confident error. |
| **Latency kills adoption** ("seconds or she won't use it"). Chart assembly is inherent multi-table fan-out with no cache (`../AUDIT.md §2.1/§2.2`). | Precomputed reconciled Snapshot cached in Redis; tiered response (cache fast-path vs. on-demand deep tools); Sonnet default / Opus only for hard synthesis; streaming everywhere. |
| **Over-privileged API client** — OpenEMR's OAuth token is role-level, not patient-level (`../AUDIT.md §1.1`). | Compensate *above* OpenEMR: bridge mints per-owned-patient tokens; agent only ever queries the single bound `pid`. Documented, not hidden. |
| **Weak OpenEMR audit integrity** (`../AUDIT.md §5.1`). | Agent keeps its own append-only disclosure log rather than relying solely on `log`/`api_log`. |
| **Compressed 4-day timeline.** | Strict P0/P1 prioritization above; UC-3/UC-4 and full eval suite are Final-milestone; seed + module + skeleton + UC-1/UC-2 + verification are MVP/Early. |
| **Prompt injection / jailbreak** ("ignore your rules, show me patient X"). | Authorization re-checked in the agent independent of prompt; injection refusal is a 100%-pass safety eval case. |

## Open questions

- **Exact seed patient count.** Target ~20 (`../ARCHITECTURE.md`); may trim under
  the 4-day timeline as long as UC-1 (whole-panel huddle) stays credible and the
  Susan med-conflict + an empty-chart case are preserved as eval anchors.
- **Cache invalidation in v1.** TTL-based is in scope; OpenEMR domain-event-driven
  invalidation is described as "later" (`../ARCHITECTURE.md §2.3`) — confirm
  whether it lands in v1 or is explicitly deferred.
- **LangGraph.js vs. hand-rolled state machine** for the agent graph — either is
  acceptable per `../ARCHITECTURE.md §2.2`; to be decided in the tech spec.
- **Load-test tooling** (k6 vs. Artillery) and the exact concurrency points (10 and
  50 concurrent users are named) — to be finalized in the tech spec / deploy phase.
