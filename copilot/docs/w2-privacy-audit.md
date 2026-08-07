# W2 privacy audit — PHI handling, egress, and the automated guard

> **Scope.** How the Week 2 multimodal surface (document ingestion + guideline RAG +
> the supervisor/worker graph) handles PHI: what PHI the system touches, where it is
> kept, what leaves the trust boundary, what is scrubbed from logs/traces/cost reports,
> and the automated check that keeps it that way. Grounded in
> [`.claude/rules/phi-and-secrets.md`](../.claude/rules/phi-and-secrets.md),
> [`W2_ARCHITECTURE.md §11`](../../W2_ARCHITECTURE.md), and the shipped code.
>
> **Synthetic data only.** This project loads no real PHI; the audit is written *as if*
> it were real so the posture is correct if it ever is.

## 1. What PHI the system handles

| PHI class | Where it enters | Where it lives | Lifetime |
|---|---|---|---|
| **Chart facts** (demographics, problems, meds, allergies, immunizations, labs) | Read from OpenEMR via FHIR, scoped to the one bound `pid` | In-request memory; optionally the W1 Redis snapshot cache (TTL) | Per-turn; TTL if cached |
| **Physician query text** | The `/chat` request body | In-request memory | Per-turn |
| **Document page images** (lab PDF / intake form) | Front-desk upload → OpenEMR `DocumentReference`/`Binary`; read via FHIR at extraction | Rasterized in-process for the VLM + OCR; held in the **Redis draft cache** as part of the pending-review draft | TTL-bounded (hours, not days) |
| **Extracted values** (lab results, intake facts) | VLM extraction output | The Redis draft cache until the physician confirms; then the **derived `Observation`** in OpenEMR | Draft: TTL; committed: OpenEMR's retention |
| **Derived `Observation`** (the one write) | Physician-confirmed value → OpenEMR module | OpenEMR `form_observation` (system of record) | OpenEMR's own retention/backup |

**Draft cache is in-boundary and minimum-necessary at rest.** Pending-review drafts
(page image + extracted values — PHI) live only in the agent's own **in-boundary Redis**,
are **TTL-bounded** (hours, not days), and are **never serialized into a log line**
(`apps/agent/src/ingestion/draftCache.ts`). There is no agent Postgres; nothing PHI-bearing
is written to durable disk by the sidecar.

## 2. Minimum-necessary to the model

The `phi-and-secrets` rule requires **minimum-necessary to the LLM** — send only the
fields a task needs, never whole charts, never a bulk FHIR `$export`, trim before the
model call. W2 upholds this per model role:

- **Answer/synthesis model (Claude):** receives the trimmed chart facts relevant to the
  question plus the retrieved guideline snippets — not the whole snapshot.
- **Grounding judge (Claude Haiku):** sees **only the cited source row**, never the whole
  snapshot (`.claude/rules/verification-gate.md`).
- **VLM (Claude vision):** receives the **one document's** page image(s) it is extracting,
  not the patient's other documents or chart.
- **Embed + rerank (Cohere):** receives **non-PHI guideline text** and the **query** only —
  never chart facts or document images (see §3).

Claude (Anthropic) is the intended **model provider**: it necessarily receives the
minimum-necessary prompt, and in production that relationship requires a **BAA** like any
model provider handling PHI. The distinction the architecture draws is between the model
provider (a given) and *auxiliary* services that could otherwise be self-hosted — those are
kept in-boundary (§4), leaving **Cohere as the single documented auxiliary egress**.

## 3. External egress — exactly one auxiliary service (Cohere)

The only auxiliary (non-model-provider) service that data leaves the trust boundary for is
**Cohere** (embed v3 + rerank v3), used by guideline RAG
(`apps/agent/src/cohere/cohereEmbed.ts`, `cohereRerank.ts`).

- **What Cohere receives:** the **guideline corpus chunks** (public-domain / open-access,
  **non-PHI**) at embed time, and the **retrieval query** at query time.
- **The residual risk:** a physician **query** may carry patient specifics (e.g. "is this
  patient due for a shingles vaccine at 68 with diabetes") — the same concern that drove
  self-hosting Langfuse. This is a **documented tradeoff**, not an accident.
- **Mitigation on record:** self-host the reranker/embedder for **zero egress** if
  required; and if `COHERE_API_KEY` is unset the agent falls back to a **deterministic
  offline embedder** (`bagOfWordsEmbed`), so the entire RAG path — and the eval gate — runs
  with **no egress at all** for local dev and CI.
- **Cohere never receives** chart facts, document images, or extracted clinical values.

## 4. What stays in-boundary (self-hosted, no egress)

- **OCR** runs **in-process** (`tesseract.js` WASM inside the agent) — the document page
  image never crosses a container boundary, let alone the trust boundary.
- **Observability (Langfuse)** is **self-hosted** on the droplet — PHI-bearing traces never
  reach a hosted tracer/analytics without a BAA (`phi-and-secrets`).
- **Draft cache (Redis)** and the **RAG index (in-memory)** are on the droplet.

## 5. What is scrubbed from logs / traces / cost reports

| Surface | Scrubbing |
|---|---|
| **Structured logs (pino)** | JSON logs only; **PHI is never interpolated into a message** (`error-handling-and-logging` rule) — context is passed as an object keyed by the **correlation ID**. Request URLs are run through `redactUrlSecrets` (`apps/agent/src/app.ts`) so the ops `?token=`/CSRF secrets never land in a log or a fronting proxy's access log. |
| **Error responses** | The Fastify error handler **never echoes `error.message`** to the caller (it may carry SQL/paths/PHI); it logs the detail with the correlation ID and returns a generic body (`apps/agent/src/app.ts`). |
| **Draft cache** | Never serialized into a log line (`draftCache.ts`). |
| **Traces (Langfuse)** | Per-encounter signals are **PHI-free** by design — tool sequence, latency, tokens, cost, retrieval hits, extraction confidence, eval outcome (`W2_ARCHITECTURE.md §9`). Self-hosted, so even PHI-adjacent detail stays in-boundary. |
| **Cost reports** | PHI-free aggregates (per-flow tokens/cost/latency) — no patient identifiers, no raw document text, no extracted values. |
| **Correlation ID** | A random UUID (`randomUUID()`), not derived from any patient identifier — safe to log and thread through every hop. |

## 6. The automated guard — the `no_phi_in_logs` eval scorer

The scrubbing posture above is not left to review discipline — it is a **deterministic,
push-blocking check** in the Week 2 eval gate.

- **`no_phi_in_logs`** (`packages/eval-harness/src/scorers/noPhiInLogs.ts`) is one of the
  five boolean rubric categories. For a case that declares `expected.forbiddenInLogs`
  (e.g. a patient name / MRN), it asserts that **none** of those substrings appears in any
  captured log line. It is a **pure, deterministic substring check** — so a regression that
  starts leaking PHI into logs fails **reproducibly**, not flakily.
- It is one of the three **deterministic regression-catchers** (`schema_valid`,
  `citation_present`, `no_phi_in_logs`) that the eval gate leans on, and it lives in the
  **safety subset that must stay 100%** (`.claude/rules/w2-eval-gate.md`). A PHI-in-logs
  regression is a **hard blocker** — never `--skip`ed, never weakened to unblock a merge.
- The gate runs **offline + deterministic** (stubbed LLM/VLM/OCR + committed fixtures) in
  the **pre-push git hook** (`copilot/scripts/eval-gate.sh`), so the check runs on every
  push with no live keys and no egress.

## 7. Secrets

All secrets — Anthropic key, **Cohere key**, HMAC bridge secret, OAuth private key,
Langfuse keys — are **env-only** (`.env` is git-ignored; `.env.example` carries only empty
placeholders). Never committed, never logged, never baked into an image layer
(`phi-and-secrets`). The ops routes (`/metrics`, `/dashboard`, `/alerts`) are token-gated,
and that token is redacted out of request-URL logs (§5).

## 8. Summary of the privacy posture

1. **Minimum-necessary** to each model role — trimmed chart facts, single cited row to the
   judge, one document to the VLM, non-PHI text + query to Cohere.
2. **One documented auxiliary egress** (Cohere), with a zero-egress offline fallback and a
   self-hostable mitigation on record.
3. **In-boundary by default** — OCR in-process, Langfuse + Redis + the RAG index on the
   droplet; no PHI on durable sidecar disk.
4. **Scrubbed everywhere** — no PHI interpolated into logs, secrets redacted from URLs, raw
   errors never returned, traces/costs PHI-free.
5. **Enforced, not trusted** — `no_phi_in_logs` is a deterministic, safety-subset,
   push-blocking check.
