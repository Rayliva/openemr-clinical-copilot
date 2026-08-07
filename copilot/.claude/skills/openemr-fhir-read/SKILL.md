---
name: openemr-fhir-read
description: Read patient data from OpenEMR inside a tool or the Context Assembler, always through packages/openemr-client — never raw fetch, never direct MySQL. Use when fetching FHIR/REST chart data such as meds, problems, labs, allergies, encounters, or immunizations.
---

# Skill: openemr-fhir-read

## When to use
Reading patient data from OpenEMR inside a tool or the Context Assembler. Always go
through `packages/openemr-client` — never a raw `fetch`, never the MySQL DB
directly.

## Steps
1. Obtain an access token via the client's cached `client_credentials` +
   `private_key_jwt` flow (see `register-oauth-client`). The client handles token
   caching/refresh.
2. Call the typed read method for the resource you need (US Core R4):
   `Patient`, `Condition`, `MedicationRequest`, `AllergyIntolerance`, `Observation`,
   `Encounter`; today's schedule via the REST calendar surface
   (`openemr_postcalendar_events`, provider 6) for UC-1.
   - **Week 2 (documents):** `DocumentReference` (list a patient's uploaded docs) +
     `Binary` (fetch the source file for VLM/OCR). Needs the `DocumentReference.read`
     + `Binary.read` scopes (`register-oauth-client`). This is still a **read** — the
     document *write* (derived Observations) goes through the OpenEMR module, not this
     client (`w2-ingest-document`).
3. **Always scope by the bound `pid`.** The pid comes from the boundary-#1 signed
   token, not from user/model input. The client should make it hard to query any
   other patient.
4. Map raw FHIR/REST rows into the tool's Zod output type, attaching **provenance**
   `{ source_table, row_uuid, fetched_at }` to every fact.
5. Represent missing data as an explicit **"no data on file"** value (absence ≠
   negative finding).
6. Fetch in **parallel** where independent (latency), then hand structured facts to
   reconciliation/snapshot assembly.

## Common pitfalls
- **Never bypass the API** with a direct DB read — it skips OpenEMR's access control
  and audit trail (`../ARCHITECTURE.md §4`, `../AUDIT.md §5`).
- **Never invoke bulk `$export`** unless a use case truly needs population data —
  it's a large-PHI egress point (`../AUDIT.md §1.6`); minimum-necessary only.
- Normalize on read — the demo data has SSN/phone format drift and ICD-9 codes
  (`../AUDIT.md §4.2/§4.4`); don't assume clean, current, ICD-10 values.
- Don't trust record dates as "current" — data can be years stale; label freshness.
- Reconcile meds across `lists` + `prescriptions` in the snapshot layer, not here —
  this skill just reads.
