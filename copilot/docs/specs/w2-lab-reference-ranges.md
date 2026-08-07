# Spec — Age/sex-aware reference ranges on the trends chart (W2)

Status: in progress · Traces to: UC-2/UC-3, the deferred lab-trend "reference band". Compounds
`w2-lab-trend-widget.md`.

## Problem

The lab-trend chart shows a value over time but no context for whether a value is normal. A
physician wants the **typical range** overlaid — and that range depends on the patient's **age and
sex** (ferritin, hemoglobin, creatinine, HDL differ by sex; ferritin by pre-/post-menopause). The
range must be **sourced** (general medical knowledge, cited), clearly labeled a *general reference*
(not a patient finding), and never invented.

## Behavior

1. A **committed corpus document** (`packages/rag/corpus/lab-reference-ranges.md`) records the
   reference ranges + their sources (MedlinePlus/NIH, ADA, ACC/AHA, KDIGO), so the same knowledge is
   available to chat RAG and is auditable/reproducible from the repo.
2. A **pure structured module** `referenceRangeFor(test, {ageYears, sex})` returns the matching
   `ReferenceRange {low, high, unit, population, source, note?}` or `null` (unknown analyte, or a
   sex-dependent analyte with sex unknown). Matched by LOINC code first, else normalized name;
   ordered so `hemoglobin a1c` ≠ `hemoglobin`, `ldl/hdl cholesterol` ≠ `total cholesterol`.
   Sex/age variants: ferritin (pre- vs post-menopausal women via age ≥ 51; men), hemoglobin,
   creatinine, HDL by sex; the rest adult ranges/targets.
3. `POST /labs/series` enriches each series with its `referenceRange` for THIS patient (age from
   `birthDate`, sex from `gender` — read from the FHIR Patient), deterministically, server-side.
4. The trends widget draws the range as a faint band on the chart (clipped to the data-driven
   y-domain so the trend stays readable) + a caption note: *"Typical {test} for {population}:
   {low}–{high} {unit} — {source}"*. Clearly a general reference, not a patient finding.

## Boundaries

- Reference ranges are **general medical knowledge**, cited to their source; they are NOT patient
  PHI and are NOT constraint-engine facts. They never enter the verification gate as a patient claim.
- Deterministic + offline: a curated, sourced table — no model call. Age/sex from the patient's own
  demographics; never guessed (sex-dependent analyte + unknown sex → no band, honest absence).
- The band never rescales the chart so far that the real trend flattens — it is clipped to the
  data-driven domain (a value far outside the normal zone still reads clearly).
- v1 factors = **age + sex** only (pregnancy/race/other deferred; noted, not silently applied).

## Acceptance criteria

1. `referenceRangeFor` unit tests: ferritin premenopausal (F<51) 13–150, postmenopausal (F≥51)
   30–400, men 30–400; hemoglobin/creatinine/HDL by sex; A1c/MCV/LDL/etc. adult; LOINC match;
   name match with A1c-vs-hemoglobin + LDL/HDL-vs-total disambiguation; sex-dependent + unknown sex
   → null; unknown analyte → null.
2. `attachReferenceRanges(series, ctx)` sets `referenceRange` per series (only when resolvable),
   pure; absence-safe on `documented:false`.
3. The route returns `referenceRange` on the demo's series (Grace F 30s: Ferritin 13–150 ng/mL
   premenopausal women, Hemoglobin 12.1–15.1 g/dL women, MCV 79–95 fL).
4. Widget renders a band + a sourced caption note; verified in a browser.
5. Corpus doc committed with sources; existing tests green; offline.

## Sources (for the corpus doc)

- Ferritin, hemoglobin, MCV, creatinine, TSH, potassium, fasting glucose: MedlinePlus (NIH) Medical
  Encyclopedia. Ferritin pre/post-menopause distinction: hematology literature (ASH).
- A1c / fasting glucose targets: American Diabetes Association.
- LDL/HDL/triglycerides/total cholesterol desirable levels: ACC/AHA cholesterol guideline.
- eGFR normal ≥ 60: KDIGO / CKD-EPI.

## Open questions

None for v1 (age+sex). Other factors (pregnancy, race-free eGFR nuances) are a documented follow-on.
