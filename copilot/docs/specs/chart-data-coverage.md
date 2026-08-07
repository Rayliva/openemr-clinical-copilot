# Spec — Full chart-data coverage (roadmap)

Status: **Approved, in build** (branch `feat/floating-agent`). Realizes the
`chart-data-serviceable` principle in full: *any clinically-meaningful datum in the
patient's chart should be answerable by the co-pilot.* Driven by live gaps (dosage, fill
date). Governed by `.claude/rules/provenance-and-grounding.md`,
`.claude/rules/phi-and-secrets.md` (minimum-necessary), `.claude/rules/authorization-and-pid-scope.md`.

## Principles

- **OpenEMR's verbiage wins.** Mirror what the chart shows. If the physician asks "when was
  it filled," answer with the exact date on file — do not lecture about prescribe-vs-dispense.
  Where a value is genuinely absent, still say so honestly (absence ≠ negative finding).
- **Every new tool is absence-aware** (`documented:false` distinct from a failed read) and
  **provenance-tagged** (`{source_table,row_uuid,fetched_at}`) so answers stay citable.
- **Minimum-necessary to the LLM** — trim to what the question needs; "most recent per type"
  for time-series (vitals/labs), not the full history dump.
- **Same authz** — all reads scoped to the bound pid; no per-tool pid argument.
- Each tool is a pure `packages/*` mapper + tool + a thin graph wiring; TDD per behavior.

## Current coverage (5 tools)

Patient (demographics), Condition (problems), MedicationRequest (meds, reconciled),
AllergyIntolerance (allergies), Immunization. OAuth client already holds
`Observation.read` + `Encounter.read` (granted but **unused** — free leverage).

## Roadmap

| # | Resource | Physician question | OpenEMR source | Scope | Phase |
|---|----------|--------------------|----------------|-------|-------|
| 1 | MedicationRequest.`authoredOn` | "when was this prescribed / filled?" | `prescriptions.date_added` | have | **A** |
| 2 | Observation (vital-signs) | "latest BP / weight / BMI?" | `form_vitals` | have | **A** |
| 3 | Observation (laboratory) | "last A1c / lipids / eGFR?" | `procedure_result` | have | **A** |
| 4 | Encounter | "when was her last visit?" | `form_encounter` | have | **A** |
| 5 | MedicationDispense | "when was it last filled?" (in-house) | `drug_sales.sale_date` → `whenHandedOver` | **add** | **B** |
| 6 | DiagnosticReport | lab/radiology report narratives | `procedure_report`/`documents` | **add** | **B** |
| 7 | Procedure | surgical/procedure history | `procedure_order`/billing | **add** | **B** |
| 8 | Coverage | insurance | `insurance_data` | **add** | **B** |
| 9 | DocumentReference | clinical notes / documents | `documents` | **add** | **B** |
| 10 | CarePlan / Goal / CareTeam | care plan, goals, care team | `form_care_plan`, etc. | **add** | **B** |

Phase A needs **no OAuth change**. Phase B's scope additions are batched into **one**
`register.ts` re-registration (fresh client → must re-enable + role=system per
`register-oauth-client` skill), then tools are wired incrementally.

## Slice 1 — Medication dates (Phase A, this slice)

### Behavior
- The med mapper extracts optional **`authoredOn`** (ISO date) from
  `MedicationRequest.authoredOn` (OpenEMR sets it from `prescriptions.date_added`,
  `FhirMedicationRequestService.php` ~L438-445). It rides on `MedicationSource` like `dosage`
  and flows through `reconcileMeds`.
- The FACTS render includes the date inline so the model can state it. When asked when a med
  was prescribed / started / filled, the agent answers with this date (the date on file) —
  exact, OpenEMR framing, no pedantic caveat.
- Absence-aware: a med with no `authoredOn` (e.g. `intent=plan` list rows, which lack a
  meaningful `date_added`) renders without a date; the model doesn't invent one.
- True dispense/fill history (`MedicationDispense.whenHandedOver`) is **slice 5** (Phase B);
  when wired it supersedes `authoredOn` for the literal "filled" question where a dispense
  row exists. Until then, `authoredOn` is the single date the chart carries for the med.

### Acceptance criteria
1. `mapFhirMedicationRequest` on a resource with `authoredOn` returns a source whose
   `authoredOn` equals it.
2. A resource without `authoredOn` yields a source with no `authoredOn` property (existing
   tests unchanged).
3. `authoredOn` survives `reconcileMeds` onto the med's `sources[]`.
4. The rendered FACTS for a dated med include the date so a "when was X prescribed/filled"
   question is answerable and grounded in that source row.

## Slice 2+3 — Vitals & Labs (Observation, Phase A)

One shared mapper, two tools (vitals and labs are the same FHIR leaf shape, different
`category`). Verified against live FHIR (Susan pid 2 has 15 vital-signs Observations, 0 labs
— so vitals exercises the populated path and labs exercises the absence path).

### FHIR shape (observed live)
- `category=vital-signs` returns a **panel** resource (LOINC 85353-1, only `hasMember` refs,
  no value → skip) plus **leaf** Observations each with `code.coding[].code` (LOINC),
  `effectiveDateTime`, and `valueQuantity {value, unit}` (e.g. Heart rate 8867-4 = 99 /min;
  Body weight 29463-7 = 150 lb_av; BMI 39156-5 = 29.3 kg/m2).
- **Blood pressure** (LOINC 85354-9) carries no top-level value — systolic (8480-6) and
  diastolic (8462-4) live in `component[].valueQuantity`.
- Some leaves have no value (Temperature Location, percentiles) → skip.
- Labs (`category=laboratory`) are the same leaf shape (value + unit + LOINC + date).

### Behavior
- `mapFhirObservations(bundle, sourceTable, fetchedAt)` → `ObservationReading[]`:
  - Leaf with `valueQuantity` → `{name, value, unit, effectiveDateTime, code, provenance}`.
  - Blood pressure (85354-9) → one reading `value="{sys}/{dia}"`, `unit="mmHg"`,
    `name="Blood pressure"` from the two components.
  - Skip panels and value-less leaves (absence ≠ a zero reading).
  - Units normalized for readability (UCUM → friendly): `mm[Hg]→mmHg`, `lb_av→lb`,
    `in_i→in`, `kg/m2→kg/m²`, `degF→°F`, `Cel→°C`.
- `mapAndCollectObservations(...)` → absence-aware `{documented, observations}`, keeping the
  **most recent reading per type** (group by name, latest `effectiveDateTime`) — the physician
  wants the current value, not the full history dump (minimum-necessary).
- Two tools: `getVitals` (category `vital-signs`, source `form_vitals`) and `getLabs`
  (category `laboratory`, source `procedure_result`). Wired into the graph, rendered into the
  FACTS with value + unit + date so the model can state and cite them.

### Acceptance criteria
1. A leaf Observation with `valueQuantity` maps to a reading with value + normalized unit +
   date + LOINC code.
2. A BP Observation (85354-9) with systolic/diastolic components maps to one
   `"{sys}/{dia}" mmHg` reading.
3. Panels (`hasMember`, no value) and value-less leaves are skipped.
4. `mapAndCollectObservations` keeps only the most-recent reading per type; an empty bundle →
   `documented:false`.
5. `getVitals` on Susan returns her documented vitals; `getLabs` on Susan returns
   `documented:false` (no lab records) — reported as "none documented," never "normal."

## Later slices

Each of slices 2–10 gets its own spec section (or file) when built, following the same
mapper → tool → graph → facts → tests shape. Observation (vitals/labs) carries the most
mapping nuance (LOINC codes, units, components for BP, "most recent per type") and will be
specced in detail before build.
