# Spec: OpenEMR OAuth2 backend-services client (token acquisition)

Traces to: PRD feature #3, tech-spec §5 (boundary #2), MVP milestone. The read
path's authentication layer (`ARCHITECTURE.md §4`). New package
`@copilot/openemr-client`.

## Context
OpenEMR's SMART backend-services flow (from `Documentation/api/AUTHENTICATION.md`):
system scopes require a **confidential client** using **`private_key_jwt`** with a
registered **JWKS (RS384)**, and the **`client_credentials`** grant. Tokens are
short-lived (~60s) with **no refresh**.

## Behavior

### Client assertion (pure)
- Build and RS384-sign a JWT assertion with claims:
  `iss = sub = client_id`, `aud = {tokenEndpoint}`, `iat = now`,
  `exp = now + ≤5min`, `jti = unique`. Header `{ alg: "RS384", kid, typ: "JWT" }`.
- Signed with the client's private key; verifiable with the registered public key.

### Token acquisition
- `POST {baseUrl}/oauth2/default/token` (form-urlencoded) with
  `grant_type=client_credentials`,
  `client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer`,
  `client_assertion={signed JWT}`, `scope={system scopes}`.
- On 2xx: parse `{ access_token, expires_in, token_type, scope }`.
- **Cache** the token in memory; reuse until a safety margin before `expires_in`
  (e.g. re-fetch when <10s remain), then fetch a fresh one. No refresh token.
- On non-2xx / network error: throw a typed error (no raw OpenEMR error text
  surfaced upward), so callers can degrade.

### Registration (setup, scripted — not agent runtime)
- A one-time script registers the client (`POST /oauth2/default/registration`,
  `private_key_jwt`, inline JWKS, system read scopes) and prints the `client_id`.
- `client_id` + private key are stored in the agent env (gitignored), never
  committed (phi-and-secrets rule).

## Scopes (read-only, minimum-necessary)
`system/Patient.read system/Condition.read system/MedicationRequest.read
system/AllergyIntolerance.read system/Observation.read system/Encounter.read`
(+ `openid` if required by the server). No write scopes, no `$export`.

## Acceptance criteria
1. The assertion has the required claims, `alg RS384`, and verifies against the
   public key; `exp − iat ≤ 300s`; `jti` differs across calls.
2. Token client issues the correct form params and parses `access_token`.
3. A cached token is reused within its lifetime; a fresh one is fetched after it
   (near-)expires.
4. Non-2xx/network error → typed error, no raw server text leaked.
5. Live: against the running OpenEMR, a registered client obtains a real
   `access_token`.

## Boundaries
- No data reads yet (authenticated FHIR reads are the next iteration) — this proves
  the token path only.
- Over-privilege note: the token is system-wide at the OpenEMR layer
  (`AUDIT.md §1.1`); compensated above by the agent only ever querying the bound
  `pid` — enforced in later iterations, documented here.

## Resolved during implementation
- **Enable step (confirmed required):** a newly-registered client is
  `is_enabled=0`, `client_role='user'`. For a backend system client it must be
  enabled *and* set to the `system` role. Dev enablement (mirrors the admin UI):
  `UPDATE oauth_clients SET is_enabled=1, client_role='system' WHERE client_id=…`.
- **Audience must be the advertised issuer.** OpenEMR advertises
  `token_endpoint: https://localhost:9300/oauth2/default/token`; the assertion
  `aud` (and the base URL) must be that **https** URL, not the http:8300 port. Dev
  uses a self-signed cert → a dev-only insecure-TLS fetch (`OPENEMR_INSECURE_TLS`).
- **`redirect_uris` is required** at registration even for `client_credentials`
  (never exercised by the backend client).
- Token lifetime observed: 300s. Signing key: RSA 2048, RS384.
