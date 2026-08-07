# API collection — Clinical Co-Pilot agent

A runnable [Postman v2.1](https://schema.getpostman.com/) collection for the agent's
core endpoints. It imports into **Postman** or **Bruno**, and runs headless via
**newman** — every request asserts on its documented contract, so a run is a real
smoke test. Spec: [`../docs/specs/api-collection.md`](../docs/specs/api-collection.md).

## Files
- `copilot.postman_collection.json` — the collection (10 requests).
- `local.postman_environment.json` — `baseUrl` + `patientId` for local runs. Copy it
  for a deployed environment (just change `baseUrl`).

The machine-readable route contract lives in
[`../apps/agent/openapi.json`](../apps/agent/openapi.json) (OpenAPI 3.0, every route);
this collection is the runnable smoke over the same routes.

## Endpoints
| Request | Contract asserted |
|---|---|
| `GET /health` | 200, `{status:"ok"}` |
| `GET /ready` | 200 or 503, `{status, checks:[{name,status}]}` |
| `GET /dev/session-token` | 200, `{token}` — saved to `{{sessionToken}}` for the token-bound routes |
| `POST /chat` | 200, `text/event-stream`, `event: done`, `Safety flags` section |
| `POST /chat` (no token) | 401 with a named error |
| `POST /chat` (invalid body) | 400 with a named error |
| `GET /documents/status` | 200, `{total, ready, extracting}` integer counts (W2) |
| `POST /documents/pending` | 200, `{documents:[{documentId,title,status}]}`, `x-correlation-id` (W2) |
| `POST /documents/extract` (user token) | 403 — a physician token is not `system:ingest` (W2 principal separation) |
| `GET /` | 200, `text/html` (dev chat page) |

`/chat` binds the patient by a signed session token (boundary #1), so the collection
first mints one and reuses it — run the agent with `COPILOT_DEV_MINT=true` and
`COPILOT_BRIDGE_SECRET` set. In production the OpenEMR bridge mints the token (enforcing
ownership); this dev-mint endpoint is the local stand-in.

## Run it

Point the environment's `baseUrl` at a running **new-code** agent (see the repo's
run instructions), then:

```bash
# headless, no install:
npx newman run api/copilot.postman_collection.json -e api/local.postman_environment.json

# override the target without editing the env file:
npx newman run api/copilot.postman_collection.json \
  --env-var baseUrl=http://localhost:3042 \
  --env-var patientId=a2326abc-c03c-4b9e-8af9-b7e03a9b4362
```

Or **import** both JSON files into Postman / Bruno and click through the requests.

> The `/chat` request needs the OpenEMR + Redis + Langfuse stack up, an
> `ANTHROPIC_API_KEY` configured for the agent (else `/chat` is disabled or degrades),
> and `COPILOT_DEV_MINT=true` + `COPILOT_BRIDGE_SECRET` (so the token mint succeeds).
> The `/documents/status` + `/documents/pending` requests additionally need an ingestion
> service configured on the agent (else those routes 404, fail-closed). The
> `/documents/extract` request asserts a **403** and needs only the route registered — it
> proves a physician (user) token cannot trigger a system extraction, without any VLM call.
> `/health` and `/ready` work regardless.
