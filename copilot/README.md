# Clinical Co-Pilot

A read-only clinical AI assistant that helps a primary-care physician work over a
patient's chart in [OpenEMR](https://www.open-emr.org). It answers questions grounded
**only** in that patient's record, cites every clinical claim to its source row, and
runs a deterministic safety gate (allergy / interaction / duplicate-therapy checks)
before anything reaches the screen. It never writes to the chart, diagnoses, or
prescribes.

This is a **sidecar**: a standalone TypeScript service alongside OpenEMR, not code
inside the PHP monolith. OpenEMR's only footprint is a thin module (chat panel +
identity bridge). See [`../ARCHITECTURE.md`](../ARCHITECTURE.md) for the full design
and the decisions/rejected-alternatives, and [`docs/PRD.md`](docs/PRD.md) for scope.

**Live demo:** **https://SITE-A-IP.sslip.io** — log in as `physician` (demo
password provided with the submission), open the patient's chart, and the co-pilot
panel + document-review / trends launchers appear bottom-right. The agent service is at
`https://copilot.SITE-A-IP.sslip.io` (`/health`, `/ready`). Synthetic data only.

---

## Week 1 baseline vs Week 2 multimodal

Week 2 is **additive** — it composes new capabilities on the Week 1 spine without changing
it. Everything in the Week 1 column still runs unchanged; Week 2 adds new sources of facts
that pass the **same** verification gate.

| Capability | **Week 1 (baseline)** | **Week 2 (multimodal, additive)** |
|---|---|---|
| Input | Chat question over one bound patient's chart | Chat **+ ingested documents** — a **lab PDF** and an **intake form** |
| Data sources | OpenEMR chart, read-only via FHIR (demographics, problems, meds, allergies, immunizations) | + a **clinical-guideline corpus** (USPSTF / CDC / ADA) retrieved on demand |
| Retrieval | Direct chart tools | + **hybrid RAG** — dense (cosine) + keyword fused via **RRF**, then **Cohere rerank** → top cited snippets (in-memory index) |
| Orchestration | Linear LangGraph: assemble → generate → verify → respond | **Supervisor + 2 workers** — a typed-Zod routing decision fans out to an **intake-extractor** and an **evidence-retriever**, logged as Langfuse child spans |
| Documents | — | **VLM extraction** against a strict Zod schema + **OCR bounding-box** cross-check (three-way: tight box / page-approximate / not-found) |
| Write path | **None** (strictly read-only) | The **one** write: a physician **confirms** extracted values in a review surface (a **zoomable** page-image with the bounding-box overlay) → the **OpenEMR module** commits a derived `Observation` (`derivedFrom` the source doc, idempotent). The sidecar still never writes. |
| Trust / safety | Deterministic citation → grounding judge → constraint engine; absence ≠ negative finding | **Same gate, unchanged**, now also covering extracted labs + keeping guideline evidence separate from patient facts |
| Quality gate | No CI (v1); safety eval subset run manually | **Eval-driven hard gate** — a 50-case boolean-rubric golden set + full suite in a **pre-push git hook** that blocks a regression (see below) |

The graded W2 requirement board is [`docs/week2-requirements.html`](docs/week2-requirements.html);
the full W2 design is [`../W2_ARCHITECTURE.md`](../W2_ARCHITECTURE.md).

---

## Eval-driven CI gate (PR-blocking)

A **pre-push git hook** runs the eval gate and **blocks any push that regresses it**. It is
**auto-installed** when you run `pnpm install` in `copilot/` (via the `prepare` script), so a fresh
clone is gated with no extra steps. Manual (re)install: `bash copilot/scripts/install-git-hooks.sh`
(or `node copilot/scripts/install-git-hook.mjs`).

The hook runs `copilot/scripts/eval-gate.sh` — the **full test suite** plus the **50-case
golden-set** eval gate (boolean rubrics: `schema_valid`, `citation_present`, `factually_consistent`,
`safe_refusal`, `no_phi_in_logs`) — fully **offline + deterministic** (stubbed LLM/VLM/OCR + committed
fixtures, no API keys). A non-zero exit **rejects the push**. Requires Node ≥22 + pnpm (`corepack enable`).

**To confirm it blocks a regression** (the grader's test): introduce a regression — make a scorer
always pass, corrupt a golden case, or break any test — then `git push`. The hook runs, an assertion
fails, and the push is **rejected**. The committed self-test `evals/w2/gate.test.ts` also re-proves
the red on every run: its `injectRegression` path must make the gate go red, so if someone weakens the
gate that test itself fails.

---

## What's here

```
copilot/
  apps/agent/        the LangGraph agent service (POST /chat SSE + ops routes; Cohere + VLM adapters)
  packages/          pure, unit-tested modules (orchestrator-only rule):
    openemr-client/    OAuth2 SMART backend-services + FHIR read client
    snapshot/          provenance-tagged mappers + medication reconciliation
    tools/             the chart tools (demographics, problems, meds, allergies, immunizations)
    verification/      the 3-layer gate: citation, grounding judge, constraint engine
    metrics/           live ops metrics + alert rules (E4/E7)
    session-token/     boundary-#1 HMAC session token (pid binding)
    ingestion/         [W2] VLM lab-PDF/intake-form extraction, Zod schemas, OCR box-match, citations
    rag/               [W2] hybrid guideline RAG — chunk, embed, dense+keyword fuse (RRF), Cohere rerank (in-memory index)
    eval-harness/      [W2] offline eval runner + the 5 boolean rubric scorers + stub engine
    eval-gate/         [W2] the gate logic — category scoring, >5% regression + threshold verdict, coverage check
  evals/             promptfoo eval suite (W1 ground truth) + evals/w2/ (the 50-case golden set + self-test)
  loadtest/          load/stress harness + saved results
  api/               Postman collection + newman smoke
  scripts/           eval-gate.sh (the pre-push hard gate) + git-hook installers
  docs/              PRD, tech-spec, specs/, oncall runbook, cost analysis, journal, w2-* docs
```

The **thin OpenEMR module** (chat UI + identity bridge + the one W2 **write** path) lives
outside `copilot/` in the monolith at
`interface/modules/custom_modules/oe-module-copilot/` — the sidecar never writes to the
chart; the module commits physician-confirmed derived facts.

## Prerequisites

- **Node ≥ 22** and **pnpm 10** (`corepack enable` picks up the pinned version).
- **Docker** — for the OpenEMR dev stack and the co-pilot's own Redis/Langfuse.
- An **Anthropic API key** (for the real `/chat` agent; tests/evals can run without).

## Local development

### 1. Bring up OpenEMR (the system of record)

From the repo root, start the dev stack (this is the standard OpenEMR
`development-easy` environment):

```bash
cd docker/development-easy && docker compose up --detach --wait
```

OpenEMR is then at `https://localhost:9300` (login `admin` / `pass`). First boot is
slow — it builds the app and self-configures the DB.

> **Gotcha:** always point the agent at `https://localhost:9300`, **not**
> `127.0.0.1`. OpenEMR's OAuth token endpoint rejects an assertion whose `aud` host
> doesn't match its configured host (`invalid_client`), and the unauthenticated
> `/ready` probe still passes on `127.0.0.1`, masking it — every chart read then fails
> and answers degrade to "I can't confirm."

### 2. Install and register the OAuth client

```bash
cd copilot
pnpm install
pnpm --filter @copilot/openemr-client register   # writes .secrets/ (git-ignored)
```

`register` creates the SMART backend-services client in OpenEMR and writes the
`client_id` + private key to `copilot/.secrets/`. See the `register-oauth-client`
skill for scope changes / key rotation.

### 3. Configure the environment

```bash
cp .env.example .env       # then fill in the blanks
```

At minimum set `ANTHROPIC_API_KEY`, `COPILOT_BRIDGE_SECRET` (any value locally),
and `COPILOT_METRICS_TOKEN` (any value, to enable the dashboard/alerts). Keep
`OPENEMR_BASE_URL=https://localhost:9300` and `OPENEMR_INSECURE_TLS=true`. `.env` is
git-ignored — secrets are env-only (`phi-and-secrets` rule).

**Week 2 additions (optional locally):**

- `COHERE_API_KEY` — enables the real **Cohere** embed + rerank for guideline RAG. Unset
  ⇒ the agent uses the deterministic offline embedder (retrieval + evals still work; only
  paraphrase-quality retrieval degrades). This is the **one external egress** — see
  [`docs/w2-privacy-audit.md`](docs/w2-privacy-audit.md).
- `COPILOT_VLM_MODEL` — the Claude **vision** model used for document extraction (default
  `claude-opus-4-8`).

The eval gate, tests, and document ingestion against committed fixtures all run **without**
either key (stubbed VLM/OCR + the offline embedder).

### 4. Bring up the co-pilot's own services

```bash
docker compose up -d        # copilot/docker-compose.yml: redis + self-hosted langfuse
```

### 5. Seed the demo data (also the eval ground truth)

The stock OpenEMR demo data is thin and misleading; load the curated dataset instead
(see the `seed-data` skill). The script runs **inside the OpenEMR container**:

```bash
# ~6 patients owned by provider 6 with clinically-varied profiles + today's schedule
cd docker/development-easy && docker compose exec openemr \
  php interface/modules/custom_modules/oe-module-copilot/scripts/seed_demo_panel.php
```

### 6. Run the agent

```bash
pnpm dev                    # tsx watch on apps/agent (restarts on change)
```

- Dev chat page: `http://localhost:3000/`
- Ops dashboard: `http://localhost:3000/dashboard?token=$COPILOT_METRICS_TOKEN`
- Alerts: `GET http://localhost:3000/alerts` (bearer `$COPILOT_METRICS_TOKEN`)

## Testing & quality

```bash
pnpm test                   # all Vitest unit/integration tests (pnpm -r test)
pnpm typecheck              # tsc across every package (strict)
pnpm eval                   # promptfoo eval suite (needs the agent reachable + a key)
pnpm eval:safety            # the safety-critical subset — must be 100% green
pnpm api:smoke              # newman run of the Postman collection
```

The eval suite is grounded in the seed data (§5) and is the ground truth for
correctness; the safety subset is a hard gate. See
[`docs/specs/eval-suite.md`](docs/specs/eval-suite.md).

## Operations

- `GET /health` — liveness. `GET /ready` — validates each dependency (redis, openemr,
  anthropic, langfuse).
- `GET /metrics` / `GET /dashboard` — live request/latency/tool/verification metrics
  (E4), token-gated.
- `GET /alerts` — alert rules evaluated against `/metrics` (E7). Runbook:
  [`docs/oncall.md`](docs/oncall.md).
- Traces: self-hosted **Langfuse** (span per node/LLM, correlation ID, tokens+cost).

## Deployment

The whole stack (OpenEMR + MariaDB + the agent + Redis + Langfuse + Caddy TLS) runs on
a single DigitalOcean droplet via Docker Compose. See
[`../deploy/README.md`](../deploy/README.md) for the droplet setup and the
`deploy-do` skill for the redeploy procedure. Deploy only committed files, and set
`COPILOT_METRICS_TOKEN` in the server `.env` or the ops routes won't register.

## Key documents

| Doc | What |
|---|---|
| [`../ARCHITECTURE.md`](../ARCHITECTURE.md) | System design, trust boundaries, rejected alternatives |
| [`../AUDIT.md`](../AUDIT.md) | How OpenEMR's data model bites an agent |
| [`../USERS.md`](../USERS.md) | The physician persona + use cases (UC-1…UC-4) |
| [`docs/PRD.md`](docs/PRD.md) | Product scope and success metrics |
| [`docs/tech-spec.md`](docs/tech-spec.md) | The locked stack and constraints |
| [`../W2_ARCHITECTURE.md`](../W2_ARCHITECTURE.md) | **Week 2** architecture — ingestion, supervisor/workers, RAG, eval gate, data model |
| [`docs/week1-requirements.md`](docs/week1-requirements.md) | **Week 1** graded-requirements tracker (live status) |
| [`docs/week2-requirements.html`](docs/week2-requirements.html) | **Week 2** graded-requirements tracker (R/A/G board; `Week_2_AgentForge.pdf`) |
| [`docs/oncall.md`](docs/oncall.md) | On-call runbook (W1 alerts + W2 failure modes) |
| [`docs/w2-privacy-audit.md`](docs/w2-privacy-audit.md) | **Week 2** PHI handling, egress, and the `no_phi_in_logs` guard |
| [`docs/cost-analysis.md`](docs/cost-analysis.md) | Actual spend + projections |
