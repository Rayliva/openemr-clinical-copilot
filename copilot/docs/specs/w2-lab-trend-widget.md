# Spec — lab trend chart widget (W2 stretch)

Status: in progress. A read-only trend chart of a patient's lab results over time, sourced from the
**committed extracted `Observation` data** (the values the physician reviewed + committed from
uploaded lab PDFs). Grounds the Week 2 "Lab trend chart widget that uses extracted Observation data"
stretch item. Reference-range band is DEFERRED (ask the user later).

## Why / the multi-PDF model
The realistic flow: a patient has one lab PDF today, another a few months later. Each PDF's extracted
values commit as FHIR `Observation`s (`category=laboratory`, `derivedFrom` the source document). The
trend reads the **union of all** such Observations and groups them by test across their collection
dates — so N PDFs over time become an N-point line per test, automatically. No dependence on a single
document; each point still traces to the specific PDF it came from.

## Behavior

### Data (`buildLabSeries`, pure, in `packages/snapshot`)
- Input: the same `Observation?category=laboratory` FHIR searchset `getLabs` reads.
- Reuses `mapFhirObservations` (every reading: name, value, unit, effectiveDateTime, LOINC code,
  provenance uuid), then instead of collapsing to latest:
  - **Groups** readings by LOINC `code` when present, else by normalized name.
  - Splits each group's readings into **numeric** points (value matches `^-?\d+(\.\d+)?$`) and
    **non-numeric** readings (e.g. "Negative", "<5.7") — the latter are surfaced, never silently
    dropped, but not plotted.
  - Each numeric point: `{ date (effectiveDateTime), value (number), rawValue, obsUuid }`, **sorted
    ascending by date**.
  - Series display name = the group's most complete reading name; unit = first non-empty unit.
- Absence-aware: no lab Observations → `{ documented: false }` (reported as "no labs on file", never
  "normal").

### Access (`POST /labs/series`, agent route)
- Same boundary-#1 auth as `/chat`: bearer session token → pid from the token (never the body),
  ownership re-checked, fail-closed 401/403. Read-only. No LLM in the path — a deterministic data
  view (like the review UI), so it does NOT pass through the generation/citation gate, but every
  point carries provenance and the turn is pid-bound.
- Returns the `LabSeriesResult` JSON. PHI stays in-boundary (same trust boundary as the chat).

### UI (floating co-pilot widget — `widget.php`)
- A **"📈 Trends"** toggle in the widget header. Opening it fetches `/labs/series` (reusing the
  widget's pid-bound token) and shows:
  - **Test-selector chips** for the tests that have ≥1 numeric point.
  - A hand-built **inline SVG line chart** (no charting library → self-contained, CSP-safe,
    deterministic) for the selected test: x = date, y = value, a dot per real reading, a polyline
    connecting them, hover → value + date. Axis labels = dates + unit.
  - **Click a point → the existing source-document overlay** (page screenshot + the value's bounding
    box), reusing the Slice-B `source-document.php` resolver (Observation uuid → derivedFrom document
    → `/documents/pending`). Every point traces to its PDF.
  - **Honest states:** 0 labs → "No lab results on file"; a test with exactly **1** numeric point →
    show the dot + "1 result on file — no trend yet" (one reading is not a trend); non-numeric
    readings listed in a small table, not plotted.
- Only connects REAL readings — no interpolation, no extrapolation, no fitted trend line, no
  prediction (`provenance-and-grounding`).

## Boundaries
- Read-only; pid-scoped; deterministic; every point provenance-tagged.
- Reference-range band + high/low coloring DEFERRED (needs the write-path to persist
  `referenceRange`/`interpretation`; revisit with the user).
- Not an LLM answer → does not go through the verification gate, but never shows a value that was not
  retrieved from the chart.

## Acceptance criteria
- **AC1** N Observations of the same test across N dates → one series with N points sorted ascending;
  different tests → separate series. (The multi-PDF case.)
- **AC2** A non-numeric reading is surfaced in `nonNumeric`, never as a plotted point; a mixed test
  plots only its numeric points.
- **AC3** No lab Observations → `{ documented: false }`.
- **AC4** `POST /labs/series` refuses without a valid token (401) and for a non-owned pid (403);
  returns the series for the bound pid otherwise.
- **AC5** The SVG builder renders a deterministic chart string for a given series (snapshot-tested);
  a single-point series renders the dot + the "no trend yet" note; each dot carries its `obsUuid`.
- **AC6** Clicking a point opens the source document overlay for that reading's `derivedFrom` PDF.

## Test plan
- `packages/snapshot/test/labSeries.test.ts` — AC1–AC3 (pure builder, inline bundles).
- `apps/agent/test/labs-series-route.test.ts` — AC4 (auth/pid-scope/shape).
- SVG builder pure unit test — AC5.
- Live-verify AC6 on the deployed site after seeding the multi-date demo set.
