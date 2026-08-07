# Skills index — Clinical Co-Pilot

Skills are *how-to* for this stack; **rules** (`.claude/rules/`) are *constraints*.

Each skill is auto-discovered by Claude Code from its `<name>/SKILL.md` frontmatter
and loads on demand when a task matches its `description` — no agent needs to read
this file first. It exists as a human-readable map of what's here.

| Skill | Use it when |
|---|---|
| [run-tests](run-tests/SKILL.md) | Running/watching Vitest (unit/integration) and promptfoo (evals), incl. the 100%-safety-critical gate. |
| [add-tool](add-tool/SKILL.md) | Adding a new Zod-contracted, provenance-returning, pure agent tool in `packages/tools`. |
| [add-verification-check](add-verification-check/SKILL.md) | Adding/modifying a verification layer (citation / grounding-judge / constraint-engine) in `packages/verification`. |
| [add-graph-node](add-graph-node/SKILL.md) | Adding a LangGraph.js node/edge as a thin wrapper over a pure module (orchestrator-only rule). |
| [add-eval-case](add-eval-case/SKILL.md) | Adding a promptfoo eval case grounded in seed data, mapped to a UC + failure mode. |
| [seed-data](seed-data/SKILL.md) | Loading/regenerating the curated demo dataset that is also the eval ground truth. |
| [register-oauth-client](register-oauth-client/SKILL.md) | Registering/rotating the OpenEMR SMART backend-services OAuth2 client. |
| [openemr-fhir-read](openemr-fhir-read/SKILL.md) | Reading patient data via `packages/openemr-client`, scoped to the bound `pid`. |
| [deploy-do](deploy-do/SKILL.md) | Deploying the Compose stack to the DigitalOcean VM — **ask-first** gate applies. |
| [openemr-gotchas](openemr-gotchas/SKILL.md) | Reading/reasoning about OpenEMR chart data — the failure modes from `../AUDIT.md` (meds disagree, ICD-9, empty≠normal, stale dates, read amplification). |
| [architecture-decisions](architecture-decisions/SKILL.md) | Any structural change — the locked decisions and **rejected alternatives** from `../ARCHITECTURE.md` (sidecar, FHIR-not-direct-DB, cached snapshot, deterministic verification, self-hosted tracing). |

## Week 2 skills (Multimodal Evidence Agent)

New `w2-*` skills, additive beside the Week 1 set (`week-scoping-convention`). Grounded
in `../../../W2_ARCHITECTURE.md` + `../../docs/w2-PRD.md`.

| Skill | Use it when |
|---|---|
| [w2-ingest-document](w2-ingest-document/SKILL.md) | Document ingestion — VLM extraction → Zod schema → OCR box-match (three-way) → human-in-the-loop review → idempotent module write of derived FHIR (`attach_and_extract`, `lab_pdf`/`intake_form`, overlay). |
| [w2-hybrid-rag](w2-hybrid-rag/SKILL.md) | Guideline RAG — corpus, chunk, Cohere embed, pgvector + keyword hybrid (RRF), Cohere rerank, cited evidence snippets (the evidence-retriever worker). |
| [w2-supervisor-workers](w2-supervisor-workers/SKILL.md) | The supervisor + intake-extractor / evidence-retriever graph — typed routing decision, thin worker nodes, handoffs as Langfuse child spans (builds on `add-graph-node`). |
| [w2-eval-ci-gate](w2-eval-ci-gate/SKILL.md) | The 50-case boolean-rubric golden set + PR-blocking CI (GitLab CI on the droplet runner + prek), >5%-regression threshold, stub/fixture design, hard-gate self-test. |

**Extended for Week 2 (in place):** `add-eval-case` (W2 boolean categories + `week:2`
tag), `openemr-fhir-read` (`DocumentReference`/`Binary` read), `register-oauth-client`
(the two new read scopes; write stays module-side).

## Open TODOs across skills (confirm during scaffolding)
- Exact pnpm script names (`test`, `eval`, `eval:safety`, `seed`).
- The seed mechanism (Node script vs SQL via `openemr-cmd`).
- The OpenEMR OAuth2 client registration endpoint + admin enablement for this fork.
- The DO VM host/user, compose file path, and build-vs-plain-`up` for deploy.
