# Target User & Use Cases — Clinical Co-Pilot

> This document is the **source of truth** for `ARCHITECTURE.md`. Every agent
> capability built must trace back to a use case here (see the IDs `UC-1…UC-4`).
> It is deliberately narrow: one user, one workflow, a handful of defensible use
> cases.

---

## The user: Dr. Donna Lee, primary care physician

Not "physicians." **One** physician, grounded in this system: Donna Lee is
`users.id = 6` in the OpenEMR install, an `authorized` provider, and patients are
already assigned to her via `patient_data.providerID = 6` — in this demo,
exactly one: Susan Underwood (pid 2). We build the agent *for her*.

**Her setting:** a busy outpatient primary-care clinic. ~18–22 patients a day in
15–20 minute slots. A mix of chronic-disease follow-ups (hypertension, diabetes,
and CKD are the bread-and-butter of primary care), acute complaints, and annual
wellness visits. In this demo her assigned panel is a single diabetes patient,
Susan Underwood, whose medication list doesn't reconcile across sources (UC-3).
She is the continuity owner: she sees the same patients over
years and is accountable for what falls through the cracks between visits.

**Her day, and the 90 seconds that matter:**
- **8:50–9:00 AM — the morning huddle.** Coffee in hand, she opens the day's
  schedule. She wants to walk in already knowing who's coming, why, and what
  changed since she last saw them — *before* the 9:00 patient is roomed.
- **Between rooms (the 90-second window).** She finishes a note, glances at the
  next chart, and has ~90 seconds to reload the next patient's context while
  walking down the hall.
- **Mid-visit.** A patient mentions a new symptom or a specialist visit; she needs
  to check the record without breaking eye contact for two minutes of clicking.

**What makes her day hard (grounded in the audit):**
- Her patients' data is **scattered across many tables** joined by `pid`/`encounter`
  (problems in `lists`, meds in *both* `lists` **and** `prescriptions`, labs in
  `procedure_result`, vitals behind the `forms` registry). Reassembling a mental
  picture means clicking through chart tabs every single time.
- **Medication truth is ambiguous.** The audit found her patient Susan's meds
  disagree across sources — 3 in `lists`, 1 in `prescriptions`, with a
  contradictory active/inactive status. Reconciling that by eye, under time
  pressure, is exactly where errors happen.
- **"What changed since last visit" is not a view that exists.** She has to
  reconstruct it from raw notes and results every time.
- **Absence is dangerous.** Susan has *no* documented allergies and *no* labs on
  file — which can read as "nothing to worry about" when the truth is "we don't
  know." (The unassigned pid 3 chart is emptier still — and outside her panel, a
  case the agent must refuse, not summarize.)

**Her non-negotiables:**
- **Speed:** seconds, or she won't use it. She'd rather have a fast, partial,
  clearly-scoped answer than a slow complete one.
- **Trust:** a single confident hallucination and she's done — permanently. Every
  claim must be traceable to her patient's actual record.
- **Safety framing:** she wants the agent to *surface what's documented* and
  *flag* concerns, not to diagnose or prescribe for her.

---

## Explicit non-goals (what the agent must refuse)

These bound the surface area and are themselves testable (see eval in
`ARCHITECTURE.md`):
- **No diagnosis and no autonomous prescribing.** It surfaces and flags; the
  clinician decides.
- **Read-only — no writes to the chart.** The agent surfaces and reconciles
  existing data; it never creates or modifies records, though this may be added as 
  a use case post-MVP. Clinical documentation stays in OpenEMR's own workflows.
- **No generic medical Q&A** ungrounded in this patient's record ("what's the
  usual dose of lisinopril?" answered from model priors is a *failure*).
- **No access to patients outside her authorization** — if she asks about a
  patient not assigned to her, it refuses and says why.
- **No stated claim without a source.** "I can't confirm that from the record" is
  a valid, expected answer.

---

## Use cases

Each use case states the user problem, **why a conversational agent is the right
shape** (the bar the case study sets), the data it needs, what "good" looks like,
and the failure modes it must guard against.

**Two primary use cases anchor the agent:** a start-of-day overview of the whole
panel (**UC-1**) and an individual-patient update right before the appointment
(**UC-2**). UC-3 (medication reconciliation) and UC-4 (pre-action safety surface)
are supporting capabilities that surface *inside* those flows rather than as
standalone destinations.

### UC-1 — Morning pre-visit huddle *(flagship)*
**Problem:** Between 8:50 and 9:00, Donna needs, for each patient on today's
schedule, *what changed since their last visit* and *what needs attention today*
(overdue labs, an abnormal result nobody actioned, a med that lapsed).
**Why an agent, not a dashboard:** the output is **synthesis across time and
sources**, and it invites **follow-up** — "why is Susan flagged?" → "she carries
a diabetes problem but has no A1c or recent labs on file." A static dashboard can
show fields; it can't
explain *what's newly important* or answer the natural next question. The value is
the reasoning, and reasoning is conversational.
**Data:** today's schedule (`openemr_postcalendar_events` filtered to provider 6),
per-patient problem list, meds (reconciled), recent labs/vitals, last-encounter
delta.
**Good looks like:** a per-patient 2–3 line "what changed + what to check," each
line with a source citation, produced for the whole panel in seconds.
**Failure modes to guard:** patient with no prior visit (nothing to diff — say so);
empty chart mistaken for "all clear"; a change asserted without a source.

### UC-2 — Pre-appointment patient update *(the 90-second scenario)*
**Problem:** Right before the appointment — between rooms, or as the patient is
roomed — Donna needs "who is this, why are they here, what's on file, what matters
today" — and then to ask one or two follow-ups.
**Why an agent:** it's a **multi-turn, question-driven recall** under time
pressure — "any recent med changes?" → "is she due for anything?" — which beats
scanning four chart tabs. The follow-up capability is the whole point; a sorted
list can't take a question.
**Data:** demographics, active problems, reconciled meds, allergies, recent
encounters for the in-context patient.
**Good looks like:** a tight snapshot in ~1–2 seconds, then sub-second grounded
follow-ups, each cited.
**Failure modes:** stale data presented as current (Susan's records are dated
2014); absent data read as reassurance — she has no allergy and no labs on file,
so the agent must say "none documented," not imply "none"; follow-up drifting
into ungrounded advice.

### UC-3 — Medication reconciliation
**Problem:** "What is this patient actually taking, and do the sources agree?"
**Why an agent:** reconciliation is **reasoning over conflicting structured
records** and *explaining* the conflict — not something a med-list widget does. The
agent unions `lists` + `prescriptions`, dedupes, and **flags disagreements with
their sources** ("`prescriptions` says Lisinopril active; `lists` marks it
inactive — please confirm").
**Data:** `lists WHERE type='medication'` + `prescriptions` for the patient, with
`active`/`activity` status and provenance.
**Good looks like:** one reconciled list, conflicts surfaced explicitly with both
sources cited, never silently picking one.
**Failure modes:** silently trusting one source; hiding a conflict; dropping an
inactive med the physician needs to see was stopped.

### UC-4 — Pre-action safety surface
**Problem:** Before Donna acts (renews, adds a med), she wants documented safety
concerns surfaced: conflicting medication status, allergies, duplicate therapy,
and — where the problem list documents it — renal or interaction flags.
**Why an agent:** it **combines allergy + problem list + med list against a rules
set and explains** in context. For Susan that is: "Lisinopril is marked active in
`prescriptions` but inactive in `lists` — confirm she's still taking it before you
renew," and "no allergies documented — treat as unknown, not clear." A dashboard
shows the fields; it doesn't connect them to the moment of acting.
**Boundary (critical):** this **surfaces existing documented flags and hard rules —
it does not recommend therapy or doses.** It is decision *support by retrieval*,
not decision *making*. This boundary is enforced by the verification layer and is
itself tested.
**Data:** allergies, problem list (incl. any documented renal status), reconciled
meds, a coded constraint/rules set.
**Good looks like:** relevant documented flags surfaced with citations (e.g. the
Lisinopril active/inactive conflict); a clear "no documented concerns found in the
record" when none exist (not silence).
**Failure modes:** inventing an interaction or allergy not supported by data;
reading Susan's absent allergy record as "safe"; overstepping into "prescribe X."

---

## Traceability anchor
`ARCHITECTURE.md` maps each capability, tool, verification rule, and eval case back
to `UC-1…UC-4`. If a capability doesn't trace to one of these, it doesn't get
built (yet).
