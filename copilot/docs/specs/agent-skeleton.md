# Spec: Agent skeleton (`/health`, `/ready`)

Traces to: PRD feature #3 (Agent Service skeleton), MVP milestone. Supports the
observability requirement (`tech-spec §10`, `ARCHITECTURE.md §2.6`).

## Behavior

### `GET /health` — liveness
- Returns **200** with JSON `{ "status": "ok" }` whenever the process is running.
- Cheap: no external calls, no I/O. It answers "is the process up?" only.

### `GET /ready` — readiness
- Runs a **registry of dependency checks**, each returning
  `{ name, status: "ok" | "error", detail? }`.
- If **all** checks pass → **200** with
  `{ "status": "ready", "checks": [...] }`.
- If **any** check fails → **503** with
  `{ "status": "not_ready", "checks": [...] }` (the failing check named, no
  internal error text leaked — `error-handling-and-logging` rule).
- The registry is **initially empty** (no external deps wired yet) → `/ready`
  returns ready. Real checks (Redis, OpenEMR API, Claude, Langfuse) are appended in
  the iterations that introduce each dependency. `/ready` must never be a bare 200
  once deps exist (`ARCHITECTURE.md §6`).

### Cross-cutting
- **Structured JSON logging** (pino). Every request carries a **correlation ID**:
  taken from an inbound `x-correlation-id` header if present, else generated;
  echoed on the response and included in every log line for that request.
- Errors never leak internals to the client (generic message + logged detail).

## Boundaries (what this does NOT do)
- No auth yet (the bridge-token verification is a later iteration).
- No `/chat`, no tools, no LLM calls.
- No real dependency checks until those dependencies are introduced.

## Acceptance criteria
1. `GET /health` → 200 `{status:"ok"}`.
2. `GET /ready` with an empty registry → 200 `{status:"ready", checks:[]}`.
3. `GET /ready` with a registered failing check → 503 `{status:"not_ready"}` and the
   failing check appears with `status:"error"`; no raw error string is exposed.
4. `GET /ready` with a registered passing check → 200 `{status:"ready"}` and the
   check appears with `status:"ok"`.
5. A request without `x-correlation-id` gets one generated and returned in the
   response headers; a request with one has it echoed back unchanged.

## Open questions
- Exact readiness-check timeout/budget per dependency — decide when the first real
  (network) check is added; not needed for the empty registry.
