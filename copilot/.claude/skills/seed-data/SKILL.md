---
name: seed-data
description: Load or regenerate the curated demo dataset, which is also the eval ground truth. Use before any UC demo or grounded eval, when eval cases need new chart data, or when the stock OpenEMR demo data proves too thin or misleading.
---

# Skill: seed-data

## When to use
Loading or regenerating the curated demo dataset. Required before any
UC demo or grounded eval — the stock OpenEMR demo (3 patients, all 2014 dates, no
labs) can't demo a clinic day and will mislead the agent (`../AUDIT.md §4`). The
seed **is** the eval ground truth, so it and the eval cases move together.

## What the seed must contain (traces to USERS.md / AUDIT.md)
- A realistic panel for **Dr. Donna Lee (`users.id=6`, `providerID=6`)** — target
  ~20 patients with **today-dated** appointments on `openemr_postcalendar_events`.
- Deliberate **inter-visit deltas** so UC-1 ("what changed since last visit") has
  something real to diff.
- **Preserved anchors** for the safety evals:
  - The **Susan Underwood med conflict** (`lists` vs `prescriptions`
    disagreement, active/inactive contradiction) — UC-3.
  - An **empty/near-empty chart** patient (absence ≠ negative) — UC-1/UC-2.
  - A **non-owned patient** (not `providerID=6`) for the authorization-refusal case.
  - The **penicillin allergy** (documented, no severity) for the constraint eval.

## Steps
1. Run the seed script against the running OpenEMR MySQL (via the Compose stack /
   `openemr-cmd`, not a direct prod DB).
   `pnpm seed`   (TODO: confirm mechanism — a Node script hitting the API/DB, or a
   SQL file loaded via `openemr-cmd`; decide at scaffold time and update this.)
2. A stack reset reloads the stock demo verbatim (`../AUDIT.md §4` provenance note)
   — so treat the seed as **re-runnable** and idempotent; never hand-edit rows as
   the fix.
3. After seeding, verify the anchors exist (Susan's conflicting meds; an empty
   chart; a non-owned pid; the penicillin allergy) before running evals.

## Common pitfalls
- **Idempotency:** re-running must not duplicate patients/appointments. Key on a
  stable external id.
- **Dates:** appointments must be *today* relative to the demo run — but note
  `Date.now()` pitfalls in any deterministic tooling; parameterize "today."
- Don't "fix" data quality away entirely — some messiness (the med conflict, the
  absent severity) is the point; it's what the agent must handle correctly.
- Keep the seed committed (GitLab source of truth) and deploy only committed files.
