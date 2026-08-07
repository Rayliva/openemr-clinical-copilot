# Spec: derive patient age as a grounded fact

## Context

Asked "how old is this patient," the co-pilot answers with the **date of birth**, not
the age. The chart stores a DOB (FHIR `Patient.birthDate`); age is *derived* (DOB +
today). The co-pilot states only facts that are in the fetched data and survive the
grounding check against that data — it has the DOB but no age fact, and a model-computed
age would be rejected by the grounding judge because the evidence (the patient row) shows
only the DOB. So it restates the DOB.

Fix: compute age deterministically from the DOB and carry it as a first-class,
provenance-tagged fact — present both in what `generate` renders and in the grounding
evidence for the patient row — so an age claim grounds and the co-pilot can answer "how
old is she" with the age.

## Behavior

- `mapFhirPatient(resource, fetchedAt)` computes `age` from `birthDate` **as of
  `fetchedAt`** (the already-injected fetch timestamp — no new clock, deterministic in
  tests). Age is whole years, decremented when the birthday has not yet occurred in the
  reference year.
- `age` is populated **only** when `birthDate` is a full, valid `YYYY-MM-DD` in the past.
  A partial date (`YYYY`, `YYYY-MM`), an unparseable value, or a future date leaves `age`
  **undefined** — never a guessed or negative age.
- The patient's grounding evidence string includes the age (e.g. `age 54`) so an age
  claim citing the patient row is grounded.
- `generate` renders the age alongside the DOB and answers an age question ("how old is
  she", "her age") with the age, citing the patient row. The DOB is still available for
  DOB questions.

## Boundaries

- Does not change name/gender/provenance handling or any other snapshot fact.
- Does not add a wall-clock read to a pure function — age uses the passed `fetchedAt`.
- Does not label the age as stored data; it is a derived value as of the fetch date.

## Acceptance criteria

- **AC1:** DOB `1971-11-05`, as-of `2026-07-10` → age `54` (birthday not yet reached).
- **AC2:** DOB `1971-05-01`, as-of `2026-07-10` → age `55` (birthday passed).
- **AC3:** birthday **is** the as-of date → counts that year (e.g. DOB `2000-07-10`,
  as-of `2026-07-10` → `26`).
- **AC4:** partial (`1971`), unparseable (`not-a-date`), or future DOB → `age` undefined.
- **AC5:** the patient evidence string contains the age when present.
- **AC6 (behavioral, live):** "how old is this patient" returns the age, not the DOB.

## Open questions

- Leap-day birthdays (Feb 29): treated as having a birthday on Mar 1 in non-leap years
  by the simple month/day comparison — acceptable for a whole-year age.
