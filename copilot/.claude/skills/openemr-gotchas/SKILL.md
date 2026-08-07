---
name: openemr-gotchas
description: The ways OpenEMR's data model and demo data will make the agent wrong — meds disagree across two tables, ICD-9 codes, empty charts that look like negative findings, stale 2014 dates, role-level (not patient-level) authorization, read amplification. Use when reading or reasoning about chart data, writing a tool or eval that touches OpenEMR, interpreting an unexpected/empty query result, or debugging a wrong agent answer.
---

# Skill: openemr-gotchas

## When to use
Any time you touch OpenEMR data — writing a tool, an eval case, a seed script, or
debugging an answer that came out wrong. Every item below is a *concrete way the
agent can be wrong*, drawn from the live DB.

Full detail with file/line references: **`../AUDIT.md`**. Section numbers below map
to it directly. Read the relevant section before acting on anything marked [high].

## The traps

**Medications live in two sources that disagree (§4.1) — [high].**
`lists WHERE type='medication'` returns 5 meds; `prescriptions` returns 1. Patient 2
has Metformin/Lipitor/Lisinopril in `lists` but only Lisinopril in `prescriptions` —
and that Lisinopril is `activity=0` (inactive) in `lists` yet `active=1` in
`prescriptions`. "Current medications" therefore depends on which table you read.
**Reconciliation is mandatory, and it is patient-safety, not cosmetic.** Interaction
and duplicate-therapy checks run on the *reconciled* list (see
`../.claude/rules/verification-gate.md`), never on one source.

**Absence is not a negative finding (§4.3, §4.7) — [high].**
Pid 3 (Wanda Moore) has zero `lists` rows and one encounter. `procedure_result`,
`immunizations`, and `documents` are all empty in stock demo data. An empty result
means *no data on file* — never "normal," "clear," or "none." Say so explicitly.
This is also a rule: `../.claude/rules/provenance-and-grounding.md`.

**Diagnosis codes are ICD-9, retired since Oct 2015 (§4.2) — [high].**
`DISTINCT diagnosis FROM lists` → `ICD9:401.0`, `ICD9:585.1`. There is a title typo
("Chronic Renal **Insuficiency**") and patient 2's diabetes code is **empty**. Code
lookups against ICD-10/SNOMED silently miss; free-text matching on the misspelling
fails.

**Dates are stale and temporally inconsistent (§4.6) — [medium].**
Every patient/encounter row is dated 2014-02-01. Every `lists.begdate`/`enddate` is
NULL, so there is no timeline. Pid 3's DOB is 2007 but her only encounter is 2014.
Age-based dosing, "recent" filters, and chronicity reasoning all go wrong if these
dates are trusted as current. Label stale data; don't smooth over it.

**The one allergy has no reaction or severity (§4.5) — [medium].**
Pid 1's penicillin allergy has empty `reaction`, NULL `severity_al`, empty
`verification`. A constraint check has no severity to weigh and no verification
status — the alert can be raised but not prioritized or caveated.

**Identifiers are format-drifted (§4.4) — [medium].**
Across 3 patients, `ss` appears in three formats (`333222333`, `112-33-5544`,
empty); `phone_home` is dashed for pid 1, plain for pid 2. Normalize on read before
any parse/match/dedupe.

**Stock demo data cannot be durably fixed by editing rows (§4 provenance).**
It ships as `demo_5_0_0_5.sql`; a stack reset reloads it verbatim. That is why the
curated seed exists and why the seed *is* the eval ground truth — see the
`seed-data` skill. Seed and eval cases move together.

## The structural constraints

**Authorization is role-level, not patient-level (§1.1) — [high].**
`AclMain::aclCheckCore` gates a *category* of PHI for *every* patient; there is no
row/care-team filter, and superusers short-circuit to allow-all. Any principal the
agent uses inherits all-patient read. The single compensating control is that we
only ever query the one bound `pid` — enforced above OpenEMR, in the sidecar. This
is a hard rule: `../.claude/rules/authorization-and-pid-scope.md`.

**Every read is amplified into a write (§2.1, §2.2) — [high].**
`ADODB_mysqli_log::Execute` audit-logs *every* statement — the demo DB already holds
2,622 `log` rows for 3 patients. Chart data is scattered across `patient_data`,
`lists`, `prescriptions`, the `forms` registry indirection, and per-encounter tables
joined by logical `pid`/`encounter` rather than PK, so one chart read is a dozen
queries and a dozen extra writes. **Do not fan out live joins per turn** — read from
the precomputed, cached Patient Snapshot.

**OpenEMR's own audit log is forgeable (§5.1).**
`log` rows carry an *unkeyed* SHA3-512 with no hash-chaining; `extended_log`
disclosures get no checksum at all. Anyone who can write the DB can rewrite history.
This is why the agent keeps its own append-only disclosure log — see
`../.claude/rules/phi-and-secrets.md`.

## Related
- `../AUDIT.md` — the full audit, with file/line references.
- `openemr-fhir-read` — how to actually read this data (via `packages/openemr-client`).
- `seed-data` — the curated dataset that replaces the misleading demo rows.
