# Spec: Redis integration + first real readiness check

Traces to: PRD feature #4 (Snapshot cache in Redis) — this lays the connection +
readiness groundwork the cache will use. MVP milestone; makes `/ready` an honest
probe (`ARCHITECTURE.md §6`).

## Behavior
- The agent connects to Redis via a `REDIS_URL` (default
  `redis://127.0.0.1:6379`), read from the environment at the process edge.
- A **`redis` readiness check** is registered on the `/ready` registry:
  - Redis reachable and answers `PING` with `PONG` → check `ok`.
  - Redis unreachable / wrong reply → check `error` → `/ready` returns **503**.
- A local **Docker Compose** service provides Redis for development (ephemeral,
  no persistence needed for the cache).
- The process shuts down cleanly on SIGINT/SIGTERM (closes the server, disconnects
  Redis).

## Boundaries
- No snapshot caching yet — this is only the connection + readiness wiring. The
  cache read/write API is a later iteration.
- No auth, no OpenEMR calls.

## Acceptance criteria
1. `createRedisReadinessCheck(client)` returns `true` when `PING` → `PONG`.
2. It returns `false` when `PING` returns anything else.
3. It rejects (propagating to the registry, which reports `error`) when the client
   throws — and no internal error text reaches the client response.
4. With Redis up, `GET /ready` → 200 and `checks` contains
   `{ name: "redis", status: "ok" }`.
5. With Redis down, `GET /ready` → 503 with `{ name: "redis", status: "error" }`.

## Open questions
- Readiness-check timeout budget (fast-fail vs. brief retry) — start with a single
  attempt / low retry so `/ready` fails fast; revisit if flaky.
