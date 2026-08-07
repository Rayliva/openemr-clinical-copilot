# OpenEMR Audit — Foundation for a Clinical Co-Pilot Agent

## SUMMARY — highest-impact findings (~500 words)

This is a mature, security-conscious EHR — it has per-request session
re-validation, CSRF protection, constant-time password checks, OAuth2 + SMART
scopes on the API, and automatic SQL-level audit logging. The audit below brings
to light some of the specific things that will bite an
AI agent bolted onto it. Five findings dominate.

**1. The authorization model is role-level, not patient-level — so any service
account is all-seeing.** `AclMain::aclCheckCore('patients', <category>)`
(`src/Common/Acl/AclMain.php:166`) grants a *category* of PHI (demographics, meds,
labs…) for *every* patient; there is no facility/care-team/row filter in
`AclMain`, and superusers short-circuit to allow-all (`:174-176`). Under a staff
account or broad OAuth token, the agent can read every chart — a direct
minimum-necessary problem. **Mitigation: give the agent a narrowly-scoped OAuth2
token (e.g. `patient/*.read` for a bound patient), not a staff login.**

**2. Weak/known credentials in the seeded environment.** Default `admin`/`pass` is
the well-known demo login; more importantly the seeded clinical users
(`clinician`, `physician`, `accountant`, `receptionist`) sit in `users_secure` at
**bcrypt cost 5** (`$2a$05$`) while `admin` is cost 12 (`$2y$12$`) — confirmed by
query. Password-policy globals are effectively off: `secure_password=''`,
`password_expiration_days=0`, empty `password_history`, `timeout=7200` (2-hour
idle). Demo defaults — but they are the account surface an agent inherits.

**3. Audit integrity is tamper-evident but forgeable, and disclosures aren't
covered.** Each `log` row gets an *unkeyed* SHA3-512 hash in `log_comment_encrypt`
(`src/Common/Logging/Audit/LogTablesSink.php:63`). Tamper-evidence needs either a
keyed hash (HMAC/secret) or hash-chaining between rows; **OpenEMR does neither. So
anyone who can write to the database can rewrite history and cover their tracks.**
HIPAA disclosure rows in `extended_log` get **no checksum at all** — and the
agent's PHI reads are exactly what we will want an un-forgeable trail of.

**4. Every read is amplified into a write, and a chart is many queries.** *In plain
terms: reading one patient's chart fires a dozen separate queries, and OpenEMR turns
every one of those reads into an extra write by logging it — so a single "read"
quietly becomes many reads and many writes.* The driver `ADODB_mysqli_log::Execute`
(`library/ADODB_mysqli_log.php:50`) audit-logs *every* query — the demo already
holds 2,622 `log` rows for 3 patients — and clinical data is scattered across
`lists`, `prescriptions`, the `forms` registry indirection, and several
per-encounter tables joined by logical `pid`/`encounter`. Live-assembling context
per request will be slow *and* multiply audit volume. **Target seconds →
precompute/cache a patient summary; don't fan out 10+ live joins per turn.**

**5. The demo data will actively mislead an agent, so data must be synthesized.**
Medications exist in **two disagreeing sources** (`lists.type='medication'` vs
`prescriptions`); diagnosis codes are **ICD-9** (`ICD9:401.0`, `ICD9:585.1`) —
retired since 2015; one patient (pid 3) has essentially **no chart**; SSNs appear
in **three formats across three patients**; the one allergy has **no reaction or
severity**. Each is a concrete agent failure mode (§4).

Full detail, with references, follows.

---

## 1. Security

**1.1 Authorization is role/category-level, not row/patient-level — [high].**
`AclMain::aclCheckCore($section, $value)` (`src/Common/Acl/AclMain.php:166`) gates a
*category* of data for a user's group — no `facility_id`, care-team, or per-`pid`
filter anywhere in `src/Common/Acl/*.php`; admins short-circuit to allow-all
(`:174-176`). Row-level scoping exists only in the optional `PatientFilter` Zend
module, **off in the base install**. So any principal the agent uses inherits
all-patient read. **Fix:** authenticate as a narrowly-scoped OAuth2 client using the
FHIR patient-binding (`apis/routes/_rest_routes_fhir_r4_us_core_3_1_0.inc.php:583-592`,
which pins a patient token to its own UUID), not a staff session.

**1.2 Default & weak seeded credentials — [high, demo-scoped].** `admin`/`pass` is
the documented demo login (`library/classes/Installer.class.php:597-641`). In live
`users_secure`, `admin` is `$2y$12$` but `accountant`, `clinician`, `physician`,
`receptionist`, `zhportal` are `$2a$05$` (**cost 5**, ~128× fewer rounds —
trivially brute-forceable offline). Policy globals are off: `secure_password=''`,
`password_expiration_days=0`, `password_history=''`, `timeout=7200`. **Fix:** rotate
accounts, raise cost / switch to Argon2id (`src/Common/Auth/AuthHash.php`), enable
`secure_password` + expiration before real data.

**1.3 `oauth_password_grant` enabled for both users and patients — [medium].** Live
`globals.oauth_password_grant = 3`. The Resource-Owner Password grant swaps
username+password directly for a token (weaker than auth-code + PKCE, and hands raw
credentials to the client). Per `UserRepository.php:91,137`: `1` = staff/API,
`2` = portal patients, **`3` = both** (broadest). Disable for the agent client —
prefer auth-code/PKCE or client-credentials.

**1.4 `$ignoreAuth` bypass pattern — [medium].** Setting `$ignoreAuth = true` before
including `interface/globals.php` skips `library/auth.inc.php` entirely
(`interface/globals.php:725-728`); the portal sets it when
`portal_onsite_two_enable==1` (live `1`). **26 PHP files** use it — login pages,
`sql_upgrade`/`acl_upgrade` scripts, webhooks/background jobs, CCDA/CCR gateways —
each expected to self-auth or be genuinely public. Do **not** let the agent reuse
this pattern for any endpoint it adds.

**1.5 STRICT SQL mode disabled — [medium].**
`src/BC/DatabaseConnectionFactory.php:68-70` runs `SET sql_mode=''` — silent
truncation/coercion of out-of-range or wrong-type values on write. With no
`strict_types` in legacy code, validate all agent writes explicitly.

**1.6 API data-exposure surface — [informational].** The FHIR/REST surface exposes
the full chart (`/fhir/Patient`, `/Condition`, `/Observation`, `/MedicationRequest`,
`/AllergyIntolerance`) plus bulk `GET /fhir/Patient/$export`
(`apis/routes/_rest_routes_fhir_r4_us_core_3_1_0.inc.php`) — a large-PHI egress
point. Scope tokens so the agent can't invoke `$export` unless it needs population
data.

---

## 2. Performance — what will constrain agent latency

**2.1 Read amplification: every query is an audit write — [high].**
`ADODB_mysqli_log::Execute` (`library/ADODB_mysqli_log.php:50`) calls
`EventAuditLogger::auditSQLEvent` on **every** statement — reads become writes; the
demo DB already holds **2,622 `log` rows for 3 patients**. **Fix:** read from a
cached, precomputed summary (one read per turn, not dozens); use `*NoLog` variants
only for genuinely non-PHI reads — never silence real PHI disclosure.

**2.2 Chart assembly is inherent multi-query fan-out — [high].** Clinical data
spreads across `patient_data`, `lists` (problems/allergies/meds by `type`),
`prescriptions`, the `forms` registry → per-`formdir` tables (`soap`, `vitals`, …),
`procedure_*`, `immunizations`, `history_data`, `insurance_data` — joined by logical
`pid`/`encounter`, **not** PK. The `forms` indirection (`sql/database.sql:2460`)
makes "list this visit's data" an N+1. **Fix:** precompute a denormalized summary
(problems + active meds + allergies + recent vitals/labs), refreshed on the domain
events services already fire (`PatientUpdatedEvent`, etc.).

**2.3 API full-logging persists request+response — [medium].** `api_log_option`
defaults to `2` (full request body + response);
`ApiResponseLoggerListener` (`src/RestControllers/Subscriber/ApiResponseLoggerListener.php:39`)
writes a JSON request/response per call — real write volume, and PHI bodies at rest.
Consider `api_log_option=1` (metadata only) for the agent client unless full bodies
are needed for compliance (§5).

**2.4 No caching layer for patient data — [medium].** The only Redis/Predis use is
**PHP session storage** (`src/Common/Session/Predis/LockingRedisSessionHandler.php`),
not data caching; `PatientService`/`FhirPatientService` read live from MySQL every
call. Uncached DB work every turn is the single biggest lever on the "seconds"
latency target.

**2.5 Small demo dataset hides scale problems — [informational].** 3 patients / 3
encounters — nothing is slow *today*. Don't infer production timings; the §2.2
fan-out is what scales badly. Load-test the agent's read path against a realistic DB.

---

## 3. Architecture — organization & integration points

**3.1 Two coexisting codebases.** Legacy procedural (`interface/`, `library/`,
`$GLOBALS`, `sql*()` functions, self-executing pages via `interface/globals.php`) vs
modern PSR-4 (`src/OpenEMR\...`, Symfony DI + events, service layer, `QueryUtils`).
Bridged: `OEGlobalsBag` mirrors writes into `$GLOBALS` (`src/Core/OEGlobalsBag.php:45`),
and both DB worlds share one ADODB connection. This survey enumerates the integration
surface neutrally; the **chosen architecture is a separate TypeScript sidecar, not
code inside this monolith** (`ARCHITECTURE.md` §Summary/§2.1). Its only PHP footprint
is a thin module that touches legacy at its seams (config, events, services) — the
sidecar does the reasoning.

**3.2 The two front doors.**
- **Legacy:** `interface/globals.php` bootstrap → page self-executes (no router).
- **API:** `apis/dispatch.php` → `ApiApplication::run`
  (`src/RestControllers/ApiApplication.php:71`) → event-driven kernel →
  `HttpRestRouteHandler::dispatch` (`src/Common/Http/HttpRestRouteHandler.php:40`) →
  `*RestController` → `*Service` → `QueryUtils` → DB. (Full trace: `ORIENTATION.md` §2.)

**3.3 Integration points for the agent (ranked).** The sidecar uses **#1 (read
path) + #5 (thin UI/identity module)**; #2–#4 are surveyed for completeness but
**not** the chosen path, since they'd pull clinical logic into the monolith.
1. **FHIR/REST API + scoped OAuth2 token** *(chosen read path)* — scoped,
   role-aware, audited (`api_log`), and the patient-binding blocks cross-patient
   reads. Requires registering a client (**0 rows in `oauth_clients`** today). Bulk
   via `$export`. See `API_README.md`/`FHIR_README.md`.
2. **Service layer in-process** *(surveyed, not chosen)* — reuse `PatientService`,
   `ConditionService` (base `lists`), `EncounterService`, `src/Services/FHIR/*`;
   reuses validation + UUIDs. Only viable if the agent ran inside PHP — it does not.
3. **Symfony EventDispatcher** — subscribe to domain events to keep a precomputed
   summary fresh (ties to §2.2/§2.4); consumable from the sidecar via a webhook/module
   relay, not required for MVP.
4. **Config via globals** — register any module-side settings in `$GLOBALS_METADATA`,
   read via `OEGlobalsBag`; sidecar secrets live in its own env, never the OpenEMR DB.
5. **UI + identity via a thin module** *(chosen)* —
   `interface/modules/custom_modules/` (`oe-module-*` extension point): the chat
   panel and the token-minting identity bridge; gate with a new `AclMain` ACL section.

**3.4 Where the agent's code + schema live.** In the **sidecar** (TypeScript/Node),
not the monolith — see `ARCHITECTURE.md` §2.2. The only OpenEMR-side code is the thin
module (#5). *If* any PHP-side schema is ever unavoidable it must follow house rules
(new namespace under `src/`, `declare(strict_types=1)`, constructor DI, **Doctrine
migrations** not `database.sql`, UUIDs via `UuidRegistry`, DB access through
`QueryUtils`/`DatabaseConnectionFactory`), but the base design keeps agent state in
the sidecar's own store.

---

## 4. Data Quality — live demo DB, framed as agent failure modes

All rows below are from the running DB; each is a concrete way the agent can be wrong.

> **Provenance:** OpenEMR's stock demo dataset (`demo_5_0_0_5.sql` from
> `openemr-devops`, loaded via `dev-reset-install-demodata`), **not** fork- or
> author-authored — confirmed by the dump's own **2014-era audit trail** (a fresh
> install can't produce 2014-dated rows). A stack reset reloads it verbatim, so these
> **cannot be durably fixed by editing rows** — the agent needs a curated dataset.

**4.1 Medications live in two sources that disagree — [high].**
`lists WHERE type='medication'` → **5** meds; `prescriptions` → **1**. Patient 2 has
Metformin/Lipitor/Lisinopril in `lists` but only Lisinopril in `prescriptions` — and
that Lisinopril is `activity=0` (inactive) in `lists` yet `active=1` in
`prescriptions`. **Failure:** "current medications" depends on which table is read;
reconciliation logic or a defined source-of-truth is mandatory — patient-safety, not
cosmetic.

**4.2 Diagnosis codes are ICD-9 (retired) — [high].** `DISTINCT diagnosis FROM lists`
→ `ICD9:401.0`, `ICD9:585.1` (ICD-9-CM retired for US clinical use **Oct 2015**); a
title typo ("Chronic Renal **Insuficiency**"); patient 2's diabetes code is
**empty**. **Failure:** no clean map to ICD-10/SNOMED for decision-support/interop;
code lookups silently miss; free-text match on the misspelling fails.

**4.3 One patient has essentially no chart — [high].** Pid 3 (Wanda Moore, DOB 2007):
blank address/contact/`race`/`ethnicity`, **zero** `lists` rows, a single "Fever"
encounter. **Failure:** retrieval returns almost nothing — a prime setting for
hallucination or false reassurance. The agent must distinguish *absent data* from
*negative finding*.

**4.4 Inconsistent identifier & contact formatting — [medium].** Across 3 patients,
`ss` appears in 3 formats (`333222333`, `112-33-5544`, empty); `phone_home` is dashed
for pid 1 but plain for pid 2. **Failure:** any parse/match/dedupe on SSN/phone
(identity resolution, external lookups) breaks on format drift — normalize on read.

**4.5 Allergy has no reaction or severity — [medium].** The single penicillin allergy
(pid 1) has empty `reaction`, NULL `severity_al`, empty `verification`. **Failure:**
an interaction check has no severity to weigh and no verification status — the agent
can neither prioritize nor caveat the alert.

**4.6 Stale, temporally inconsistent records — [medium].** All patient/encounter rows
are dated **2014-02-01** (11+ years stale); every `lists.begdate`/`enddate` is
**NULL** (no timeline); pid 3's DOB is 2007 yet her only encounter is 2014.
**Failure:** age-based dosing/screening, "recent" filters, and chronicity reasoning
all go wrong if the agent trusts these dates as current.

**4.7 Thin clinical breadth — [informational].** `procedure_result=0`,
`immunizations=0`, `documents=0`; 3 encounters (`soap` + `vitals`). Retrieval often
returns empty for labs/imaging/immunizations. **Failure:** empty mistaken for
"nothing abnormal" — design the agent to say "no data on file" explicitly.

**4.8 Referential integrity is clean — [positive].** 0 orphans; **100%** UUID coverage
on `patient_data`, `form_encounter`, `lists`, `prescriptions`; no duplicate (name,
DOB). The *structure* is sound; the *content* is the risk.

---

## 5. Compliance & Regulatory (HIPAA)

**Assumptions:** for development we assume a signed BAA with **every third party that
could touch PHI** — the LLM provider(s) *and* any subprocessor in the request path,
explicitly including hosted **observability/tracing** (e.g. LangSmith) if adopted;
demo/synthetic data throughout, so no real PHI is disclosed. Recorded deliberately,
not overlooked (§5.5). Below is what would need to be true for *real* PHI.

**5.1 Audit controls — §164.312(b).**
- **Present:** `enable_auditlog=1`; automatic SQL auditing (`ADODB_mysqli_log.php:50`
  → `EventAuditLogger::auditSQLEvent`), patient-view events
  (`src/Common/Session/PatientSessionUtil.php:80`), login success/failure, API access
  → `api_log`. ATNA RFC-3881 export exists (`AtnaSink.php`) but is **off** by default.
- **Gap — weak integrity:** `log` rows use an **unkeyed** SHA3-512
  (`LogTablesSink.php:63`) — no HMAC, no hash-chaining; a DB-write actor can alter a
  row and recompute a valid checksum, and deletion/reordering is undetectable. The
  checksum is only ever *written* (its one read is the audit-report SELECT in
  `EventAuditLogger.php:357`); no re-keying or integrity-check job exists.
- **Gap — disclosures unprotected:** `extended_log`
  (`EventAuditLogger::recordDisclosure:567`) gets **no checksum**, and
  `deleteDisclosure():622` hard-deletes — the most sensitive log, least protected.
- **Gap — local API bypass:** an `APICSRFTOKEN` header flags a request local
  (`HttpRestRequest.php:154`), skipping **both** OAuth authorization
  (`AuthorizationListener.php:154`) **and** `api_log` response logging
  (`ApiResponseLoggerListener.php:53`). So in-process local-API reads are neither
  authorized nor audited — ensure the agent's reads are logged on every path.

**5.2 Sending PHI to an external LLM = a disclosure to a Business Associate.** Even
under a BAA, this is a disclosure — must be minimum-necessary and accountable.
**Minimum-necessary (§1.1):** use a scoped token, send only the fields the task needs
— not whole charts, never `$export` unless required. **Accountability:** FHIR reads
leave an `api_log` trail; for in-process reads, log explicitly and consider
`recordDisclosure()`. Given §5.1's gaps, protect these logs as evidence (write-once /
external SIEM) if this ever holds real PHI.

**5.3 Data retention.** HIPAA generally requires **6-year** retention of
audit/accounting records. No automated purge for `log`/`api_log`/`extended_log`, and
**no append-only enforcement** (no triggers, no revoked DELETE grant) on `log` —
tables grow unbounded (2,622 rows already for 3 demo patients). Define retention +
archival before production; §2.1 read volume makes growth material.

**5.4 Breach notification.** PHI sent outside BAA terms, or tampered logs, trigger
breach rules (§164.400-414). Weak audit integrity (§5.1) undermines proving what was
and wasn't disclosed during an incident — exactly what breach analysis depends on.
Hardening audit integrity (keyed hash or an append-only external log for agent
disclosures) is the highest-value compliance investment for this project.

**5.5 BAA coverage extends to every PHI subprocessor, not just the LLM.** Any
third-party service in the request path that could *observe* PHI is equally a
subprocessor requiring a BAA — most relevantly a **hosted observability/tracing
platform** (e.g. LangSmith), which by design captures prompts, tool inputs/outputs,
and completions verbatim, i.e. the exact PHI-bearing payloads. **Confirmed
assumption:** for development we may assume a BAA is available for such services too,
on synthetic data only — recorded explicitly so it is visibly *not* missed.
Consequence: it keeps a SaaS tracer on the table for dev, but because relying on a
chain of external BAAs widens the disclosure surface, the design still **prefers
self-hosted observability** (Langfuse) so PHI-bearing traces never leave the trust
boundary at all (`ARCHITECTURE.md §2.6`, trust boundary #3). Rule for any future
tool: **no PHI to a third party without a signed BAA**, and prefer keeping PHI
in-boundary over depending on one.

**5.6 Net position for this project.** Under the stated assumptions (BAA with the LLM
provider *and any PHI-touching observability subprocessor* + demo data), clear to
proceed. Before any real PHI: (1) scope the agent's token to minimum-necessary
(§1.1/§5.2); (2) harden audit integrity and log the agent's reads on *every* path
(§5.1); (3) define retention (§5.3); (4) rotate/strengthen the seeded credentials
(§1.2); (5) execute BAAs with every subprocessor in the PHI path, or keep that data
in-boundary (§5.5).
