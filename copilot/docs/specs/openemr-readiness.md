# Spec: OpenEMR reachability + readiness check

Traces to: PRD feature #3/#4 (agent read path), MVP milestone. First connection
from the agent to the OpenEMR API it will read through (`ARCHITECTURE.md §4`).

## Context
Local OpenEMR is the repo's existing `docker/development-easy` stack (flex image,
REST/FHIR + system scopes enabled, admin/pass), already running on host ports
8300 (http) / 9300 (https). The sidecar reuses it rather than duplicating
openemr+mysql into `copilot/docker-compose.yml` (tech-spec §11). The agent reads
via the API only — it never touches MySQL directly — so MySQL needs no separate
readiness check (a DB outage surfaces as an OpenEMR API failure).

## Behavior
- Config `OPENEMR_BASE_URL` (default `http://localhost:8300`) and
  `OPENEMR_PROBE_TIMEOUT_MS` (default 8000), read at the process edge.
- An **`openemr` readiness check** on `/ready` probes the **OIDC discovery
  document** (`GET {baseUrl}/oauth2/default/.well-known/openid-configuration`) — a
  public, unauthenticated endpoint that validates the OAuth token surface the
  agent's read path needs *first* (before it can fetch any data):
  - Response 2xx within the timeout → check `ok`.
  - Non-2xx, timeout, or network error → check `error` → `/ready` 503.
- **Why not the FHIR CapabilityStatement:** measured at ~6–7s to build on the dev
  container (Windows bind-mount + dev-mode PHP); the OIDC doc is faster and more
  relevant to our flow. All OpenEMR dev endpoints are slow (~3–6s), hence the
  generous, configurable timeout — production will be far faster, so the timeout
  can be tightened there.

## Boundaries
- No OAuth/token flow yet (that's the next iteration); the capability statement is
  public by SMART, so no auth is needed to probe it.
- No data reads, no reconciliation.

## Acceptance criteria
1. `createOpenEmrReadinessCheck` is `ok` when the probe responds 2xx.
2. It is `false` when the probe responds non-2xx (e.g. 500).
3. It rejects (registry → `error`) when the fetch throws.
4. It rejects when the probe exceeds the timeout.
5. Live: with dev-easy up, `GET /ready` includes `{ name: "openemr", status: "ok" }`
   alongside `{ name: "redis", status: "ok" }`.

## Open questions
- Whether to later switch the probe to an authenticated lightweight read once the
  OAuth client exists (would also validate the token path) — deferred; the public
  capability probe is the right minimal readiness signal for now.
