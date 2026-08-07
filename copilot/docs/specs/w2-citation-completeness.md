# Spec — Full 5-field machine citations on every chart claim (W2 #4)

Status: in progress · Traces to: Core Req 5 (Citation contract), UC-2/UC-3, PDF p5
"Every clinical claim in the final response must include machine-readable citation
metadata. Minimum shape: `{source_type, source_id, page_or_section, field_or_chunk_id,
quote_or_value}`."

## Problem

The `/chat` `done` frame already attaches a citation object to every **grounded** claim
(`chat.ts` `citations[]`), and guideline-backed claims carry rich source metadata. But a
**chart-derived** claim's source is emitted as `{ ref, kind: "chart" }` only — 2 of the 5
required fields. The verification passed a real graded requirement as partial: a medication
/ problem / lab claim in the final answer does not carry the minimum machine-readable shape.

The camelCase `Citation` in `@copilot/ingestion` already models all 5 fields but is the
*ingestion-path* contract and its snake_case wire form was explicitly deferred
(`packages/ingestion/src/citation.ts`). This spec produces the canonical snake_case shape at
the response boundary for **both** chart and guideline claims.

## Behavior

At the `/chat` `done` frame, every grounded claim carries a `citation` array — one
`MachineCitation` per cited `sourceRef` — in the canonical snake_case shape:

```
MachineCitation = {
  source_type:      "chart" | "guideline",
  source_id:        string,   // the record/chunk identity
  page_or_section:  string,   // chart: OpenEMR source table; guideline: section (+ "(p.N)")
  field_or_chunk_id:string,   // chart: row uuid; guideline: chunk id
  quote_or_value:   string,   // chart: serialized fact content; guideline: passage text
}
```

Field mapping:

| field | chart claim | guideline claim |
|-------|-------------|-----------------|
| `source_type` | `"chart"` | `"guideline"` |
| `source_id` | row uuid (`sourceRef`) | corpus doc name |
| `page_or_section` | source table (`lists`, `prescriptions`, `form_observation`, `documents`, …); `"chart"` if unknown | section, suffixed `" (p.N)"` when a page is known |
| `field_or_chunk_id` | row uuid (`sourceRef`) | chunk id |
| `quote_or_value` | serialized fact content (the same string the grounding judge saw via `evidenceIndex`); `""` if unknown | passage text |

The existing `sources` (camelCase `CitedSource`) and `sourceRefs` remain on each entry for
backward-compat with the widget's "Sources (N)" renderer — `citation` is **additive**.

## Boundaries

- Chart source table resolved from fact/document **provenance** (`Provenance.sourceTable`),
  not parsed from prose. Deterministic; no model call.
- Only the leak-safe **grounded** claim set is cited (unchanged) — no withheld/ungrounded
  statement is ever emitted.
- No new PHI to logs/metrics/traces. The `done` frame already carries `quote_or_value`
  content (it is the answer's own cited evidence, shown to the physician) — this spec adds
  no new field to any log line.
- Guideline vs chart citations stay distinguishable (`source_type`), never merged into one
  uncited claim (`w2-multi-agent-orchestration`).

## Acceptance criteria

1. Given a chart-grounded answer, every `citations[].citation[]` object has all 5 fields
   non-empty (except `quote_or_value` may be `""` only when no content is indexed).
2. `source_type` is `"chart"` for a chart row and `"guideline"` for a retrieved chunk.
3. `page_or_section` for a medication claim is its OpenEMR source table (e.g. `prescriptions`
   / `lists`); for a guideline claim it is the section (with `(p.N)` when present).
4. Guideline path output is unchanged for the existing `sources`/`sourceRefs` fields.
5. A pure unit test covers chart, guideline, mixed, and unknown-ref (fallback) cases.
6. Existing `chat.ts` tests stay green; the done-frame shape gains `citation` without
   removing any field.

## Design

- New pure module `apps/agent/src/graph/machineCitations.ts`:
  - `MachineCitation` type (snake_case).
  - `toProvenanceTableIndex(facts, documents): Record<string,string>` — `rowUuid → sourceTable`
    over the same fact groups `toEvidenceIndex` walks, plus on-file documents.
  - `buildClaimCitations(sourceRefs, evidence, provenanceIndex, evidenceIndex): MachineCitation[]`
    — guideline when the ref matches an `EvidenceSnippet.chunkId`, else chart.
- Wire into `chat.ts`: build `provenanceIndex` once from `outcome.facts` + `outcome.documents`,
  then add `citation: buildClaimCitations(...)` to each `citations[]` entry.

## Open questions

None.
