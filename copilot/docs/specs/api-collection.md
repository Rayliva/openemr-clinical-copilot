# Spec: Runnable API collection (E5)

Traces to: engineering requirement **E5** — "a runnable API collection (Postman/Bruno)
for core endpoints." Lets a reviewer exercise every agent endpoint and see the
contracts, without reading the code.

## Deliverable
A Postman **v2.1** collection (`api/copilot.postman_collection.json`) — the portable
format: imports into Postman *and* Bruno, and runs headless via `newman`. An
environment file (`api/local.postman_environment.json`) holds `baseUrl` + `patientId`;
a deployed environment is added when the sidecar ships.

## Endpoints covered (the agent's full public surface)
- `GET /health` — liveness. Assert: 200, body `{status:"ok"}`.
- `GET /ready` — readiness (deps: redis, openemr, langfuse, anthropic). Assert: code is
  200 or 503, body `{status: "ready"|"not_ready", checks: [{name, status}]}`.
- `POST /chat` — the agent turn (SSE). Body `{patientId, messages:[{role,content}]}`.
  Assert: 200, `content-type: text/event-stream`, stream contains `event: done` and
  (for Susan) the `Safety flags` section.
- `POST /chat` (invalid) — missing `messages`. Assert: 400.
- `GET /` — dev chat page. Assert: 200, `text/html`.

## Acceptance criteria
1. The collection imports cleanly (valid v2.1 JSON) and every request resolves
   `{{baseUrl}}`/`{{patientId}}` from the environment.
2. Each request carries `pm.test` assertions on its documented contract (not just a
   bare call) — so `newman run` is a real smoke test, green against a running agent.
3. A README documents import + `newman` usage and the env switch (local ↔ deployed).

## Boundaries
- Not a load test (E8/E9) and not the eval suite — this is contract/smoke coverage.
- No secrets in the collection; `patientId` is seed data, not PHI.
