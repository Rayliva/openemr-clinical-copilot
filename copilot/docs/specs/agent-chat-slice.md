# Spec: Thin agentic vertical slice (chat + verification + observability)

A deliberately thin end-to-end slice that exercises three graded requirements
together: the **agentic chatbot** (multi-turn, tool-invoking), the **verification
layer** (source attribution), and **real observability** (Langfuse). Breadth of the
data layer is intentionally deferred; correctness of the *pipeline* comes first.

Traces to: UC-2 (multi-turn, question-driven pre-visit recall). Every piece below
traces to that use case or to an engineering requirement.

## Components (built in this order, each TDD'd)

### 1. `/chat` SSE endpoint (Fastify) — multi-turn
- `POST /chat` accepts `{ patientId, messages: [{role, content}] }` — the prior
  conversation turns plus the new user turn — and streams the assistant response
  back over **SSE** (`text/event-stream`).
- **Multi-turn:** the endpoint is stateless per request; the client sends the full
  turn history, and the agent reasons over it (UC-2's "ask a follow-up").
- Carries the correlation id (inbound `x-correlation-id` or generated), echoed and
  traced (§5).
- **Boundary:** `patientId` is supplied in the request for this slice. The signed
  bridge-token binding (authz) is a later iteration — noted, not built here.

### 2. LangGraph.js loop — thin nodes over pure modules
Graph: `assembleContext → generate → verify → respond`. Honors the
**orchestrator-only rule**: nodes are thin wrappers; all logic lives in `packages/*`
pure modules (tools, verification) with their own unit tests.
- `assembleContext`: invokes the tool(s) the turn needs; collects provenance-tagged
  facts into typed state.
- `generate`: calls the LLM (injected — see §7) to produce a structured answer:
  `{ claims: [{ statement, sourceRefs: [rowUuid] }] }`.
- `verify`: runs verification layer 1 (§4) over the claims + retrieved provenance.
- `respond`: streams the **verified** answer (or a degraded message) to the client.
- **Verify-before-display:** the model output is produced in full, verified, then
  streamed to the client — so nothing unverified reaches the user. (True
  token-level streaming with post-hoc verification is a documented future
  refinement; the slice buffers-then-streams to keep the guarantee.)

### 3. One Zod-contracted tool — `getPatientDemographics`
- Input Zod schema: `{ patientId: string }`. Output Zod schema:
  `{ found: true, demographics: PatientDemographics } | { found: false }` where
  `PatientDemographics` carries provenance (from `@copilot/snapshot`).
- Wraps the existing path: `@copilot/openemr-client` FHIR read → `mapFhirPatient`.
- The **Zod schema is the source of truth**; its JSON Schema is exported for the
  LLM tool definition (never hand-written).
- `found: false` is the explicit **"no data on file"** sentinel — distinct from a
  negative finding.

### 4. Verification layer 1 — deterministic citation check
Pure, unit-tested, in `@copilot/verification`.
- Input: the model's `claims` + the set of provenance refs actually retrieved this
  turn. Output: a verdict `{ ok, verifiedClaims, rejectedClaims }`.
- **Rule:** every claim's `sourceRefs` must be non-empty and each ref must resolve
  to a `rowUuid` present in the retrieved provenance. A claim that fails is
  **dropped and never stated**; if that empties the answer, the agent degrades to
  "I can't confirm that from the record." **Never** silently pass an uncited claim.
- **What it catches:** fabricated facts (no source), fabricated/hallucinated
  citations (ref not in retrieved set), claims about data that wasn't fetched.
- **What it does NOT catch (documented limitations):** a claim that cites a *real*
  source but *misrepresents* it (that needs the semantic grounding judge, layer 2 —
  not in this slice); clinical-constraint violations (layer 3 — not in this slice).
  So layer 1 guarantees *traceability*, not *faithfulness* or *clinical safety*.

### 5. Langfuse tracing — the first real observability
- Add `langfuse` + `langfuse-postgres` to `copilot/docker-compose.yml`
  (self-hosted; PHI-bearing traces stay in-boundary).
- One **trace per `/chat` request**, keyed by the correlation id; a **span per
  node, tool call, and LLM call**; capture **tokens + cost** on the LLM span and
  latency on every span. Tool failures recorded on their span.
- **Must be used, not just installed:** the live verification at the end inspects
  the emitted trace (spans present, correlation id attached, tokens/cost recorded).

### 6. `/ready` gains LLM + observability checks
- Add an **Anthropic** check (cheap `GET /v1/models` — validates the key, no token
  cost) and a **Langfuse** check (its health endpoint), alongside the existing
  `redis` + `openemr` checks. Satisfies the rubric: `/ready` validates OpenEMR +
  LLM + observability reachability. All bounded by timeouts (reuse `withTimeout`).

## Model
Claude via the **Vercel AI SDK**, **Sonnet default** (`claude-sonnet-5`).

## Testing strategy (§7)
- Steps 1–4 are TDD'd with a **mocked LLM** — the model/generate function is
  injected at the boundary, so unit/integration tests never hit the network.
- Steps 5–6 and the final **end-to-end live verification** need a real key
  (`ANTHROPIC_API_KEY`, in git-ignored `copilot/.env`). The key is requested when
  those steps are reached; earlier steps do not block on it.

## Acceptance criteria
1. `POST /chat` streams an SSE response over a multi-turn `messages` array; the
   correlation id is echoed and appears in the trace.
2. The agent invokes `getPatientDemographics` (tool call visible in the trace) and
   answers a demographics question grounded in the result.
3. A follow-up turn (e.g. "and her date of birth?") is answered using conversation
   context — demonstrating multi-turn.
4. The citation check drops/degrades any claim whose `sourceRefs` don't resolve to
   retrieved provenance (unit-tested with a fabricated citation); a valid claim
   passes and is stated with its source.
5. `getPatientDemographics` returns `{found:false}` for an unknown patient, and the
   agent says "no data on file," not a negative finding.
6. A Langfuse trace exists for a request, with a span per node/tool/LLM call,
   correlation id attached, and tokens+cost recorded.
7. `/ready` returns 503 when Anthropic or Langfuse is unreachable, 200 when all
   four dependencies (redis, openemr, anthropic, langfuse) are up.

## Requirements coverage (report at the end)
- **Agentic chatbot:** multi-turn `/chat` + tool invocation over UC-2. (Tool
  *chaining* across multiple tools is not yet exercised — one tool in this slice.)
- **Verification:** source-attribution (layer 1) wired into the flow with graceful
  degradation. (Grounding + clinical-constraint layers still to come.)
- **Observability:** Langfuse traces with per-step spans, tokens/cost, correlation
  id; `/ready` validates all three dependency classes. (Dashboard, alerts, load
  baselines still to come.)

## Out of scope (this slice)
- Bridge/authz token binding; med reconciliation and other tools; grounding judge +
  constraint engine; the Langfuse dashboard/alerts; load tests; the OpenEMR module
  chat UI.
