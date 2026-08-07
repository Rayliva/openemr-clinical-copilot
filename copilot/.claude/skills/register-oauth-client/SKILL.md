---
name: register-oauth-client
description: Register or rotate the OpenEMR OAuth2 client the Agent Service uses to read FHIR/REST data. Use on a fresh OpenEMR install (oauth_clients is empty), when adding an OAuth scope for a new data type, or when rotating keys.
---

# Skill: register-oauth-client

## When to use
Registering (or rotating) the OpenEMR OAuth2 client the Agent Service uses to read
FHIR/REST data. `oauth_clients` is empty on a fresh install (`../AUDIT.md §3.3`), so
this is a one-time MVP prerequisite plus occasional key rotation.

## The chosen flow (locked in tech-spec §5)
- **SMART backend-services**: confidential client, **`client_credentials` grant**
  with **`private_key_jwt`** (asymmetric key assertion). **Not** the password grant
  (`../AUDIT.md §1.3`).
- **System read scopes only:** `system/Patient.read`, `system/Condition.read`,
  `system/MedicationRequest.read`, `system/AllergyIntolerance.read`,
  `system/Observation.read`, `system/Encounter.read`.
  - **Week 2 adds two read scopes** for document ingestion:
    `system/DocumentReference.read` + `system/Binary.read` (list + fetch uploaded
    source documents; `w2-ingest-document`, `openemr-fhir-read`). Re-register /
    re-enable the client to add them (fresh `client_id`), same as the W1 immunization
    scope add. **Still read-only** — the derived-fact *write* goes through the OpenEMR
    module, so **no write scope** is requested (the read-only-client invariant holds).

## Steps (automated — confirmed working on local dev)
1. **Register** (generates an RS384 keypair, writes key + client_id to
   `copilot/.secrets/`, git-ignored):
   `OPENEMR_BASE_URL=https://localhost:9300 OPENEMR_INSECURE_TLS=true \`
   `pnpm --filter @copilot/openemr-client register`
   - Uses inline JWKS, `private_key_jwt`, `client_credentials`, the read scopes
     above, and a placeholder `redirect_uris` (required even though unused).
2. **Enable** the client (new clients are `is_enabled=0`, `role=user`; a backend
   system client needs both flipped). Admin UI: *Administration → System → API
   Clients*. Dev SQL (mariadb client in the dev-easy stack):
   `docker exec development-easy-mysql-1 mariadb -uroot -proot openemr -e \`
   `"UPDATE oauth_clients SET is_enabled=1, client_role='system' WHERE client_id='<id>';"`
3. **Verify** a token: `pnpm --filter @copilot/openemr-client token`.
4. The agent reads `client_id` + key from `.secrets/` (or env); the token client
   obtains + caches tokens via the signed assertion.

## Gotchas found (local dev)
- **`aud` = the advertised issuer.** OpenEMR advertises the token endpoint as
  `https://localhost:9300/...`; the assertion `aud` and the base URL must be that
  **https** URL. Dev uses a self-signed cert → set `OPENEMR_INSECURE_TLS=true`
  (dev only). Production uses the real host + cert, no insecure flag.
- On the DO stack, substitute the public https base URL and enable the client via
  the admin UI (no direct DB access assumed).

## Common pitfalls
- **Over-privilege is expected and compensated, not fixed here** — the token is
  system-wide at the OpenEMR layer (`../AUDIT.md §1.1`). The agent restricts to the
  single bound `pid` *above* OpenEMR; do not rely on the token to scope patients.
- **Don't enable the password grant** or reuse `$ignoreAuth` patterns
  (`../AUDIT.md §1.4`).
- Private key leakage = full read access — treat rotation as a security event.
- Requesting write scopes contradicts the read-only v1 boundary — request read
  scopes only.
