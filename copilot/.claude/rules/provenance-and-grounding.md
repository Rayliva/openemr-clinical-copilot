# Provenance & grounding

Trust is engineered. One confident hallucination loses the user permanently
(`../USERS.md`). Every clinical statement must trace to this patient's record.

## The rules
- The agent answers **only from tool output** — never from model priors. Generic
  medical Q&A ungrounded in the record ("usual dose of lisinopril") is a **failure**.
- **Every fact carries provenance** `{source_table, row_uuid, fetched_at}` from the
  moment a tool returns it. A fact without provenance cannot be shown.
- Every clinical claim in a response is **atomic** `{statement, source_refs[]}` and
  each ref must resolve to a retrieved row (enforced by the citation check).
- **Absence ≠ negative finding.** Missing data is reported as "no data on file" /
  "none documented," never as "normal," "clear," or "all good"
  (`../AUDIT.md §4.3/§4.7`).
- **Stale/partial data is labeled**, not smoothed over (records may be years old).

## Why
Sources let Donna judge each claim; the absence/negative distinction prevents false
reassurance on empty charts, which is a patient-safety failure.

## Do / Don't
- **Do:** "No allergies are documented for this patient — treat as unknown, not
  confirmed absent. [source: none on file]"
- **Don't:** "Patient has no allergies." (implies confirmed-absent)
- **Do:** cite the `lists` row uuid for a problem.
- **Don't:** state a lab value the tools didn't return, even if plausible.
