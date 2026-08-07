# Spec: Authenticated FHIR read + provenance-tagged Patient

Traces to: PRD feature #4 (Context Assembler / Snapshot), UC-2 (demographics),
tech-spec §5 (read path). Establishes the read → map-with-provenance pattern every
tool follows (`ARCHITECTURE.md §2.3/§2.4`).

## Behavior

### FHIR client (raw reads — `@copilot/openemr-client`)
- `OpenEmrFhirClient` performs **authenticated** GETs against
  `{baseUrl}/apis/default/fhir/...` with `Authorization: Bearer {token}` (token
  from the `OpenEmrTokenClient`) and `Accept: application/fhir+json`.
- `read(resourceType, id)` → the resource JSON (validated as *a* FHIR resource of
  the requested type; deeper shape validation is the caller's job).
- `search(resourceType, params)` → a FHIR Bundle JSON.
- Non-2xx / network error → typed error, no raw server text surfaced upward.

### Provenance + Patient mapping (`@copilot/snapshot`)
- `Provenance` value: `{ sourceTable, rowUuid, fetchedAt }` — attached to every
  assembled fact.
- `mapFhirPatient(resource, fetchedAt)` → `PatientDemographics`:
  `{ id, name, birthDate?, gender?, provenance }` with
  `provenance = { sourceTable: "patient_data", rowUuid: <fhir id>, fetchedAt }`.
- Missing optional fields are represented as absent (undefined), never guessed
  (absence ≠ negative — later tools surface "not documented").

## Boundaries
- Read-only. No caching yet (snapshot cache is a later iteration).
- No reconciliation, no other resources yet — just the Patient demographics slice.
- pid→FHIR-id resolution is out of scope here (the bound-patient authz wiring comes
  with the bridge); this iteration reads a known patient id to prove the path.

## Acceptance criteria
1. `read` issues `GET {base}/apis/default/fhir/{type}/{id}` with the bearer token
   and fhir+json Accept header; returns the parsed resource.
2. Non-2xx → typed error; the raw server body is not in the thrown message.
3. `mapFhirPatient` produces the demographics + provenance; absent fields stay
   undefined.
4. Live: with a registered+enabled client, reading Susan Underwood's Patient
   resource returns her demographics, mapped with provenance.

## Resolved during implementation
- Live US-Core Patient shape confirmed: `name: [{use, family, given[]}]`,
  `gender: "female"`, `birthDate: "1967-02-08"`. The mapper prefers the `official`
  name and joins given + family; the unit-test fixture is Susan's real payload.
- Susan's FHIR id: `a2326abc-c03c-4b9e-8af9-b7e03a9b4362`.
- FHIR calls also need the https base + insecure-TLS in dev (same as OAuth).
