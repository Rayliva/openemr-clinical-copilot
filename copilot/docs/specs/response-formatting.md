# Spec — Response formatting (grouped claims + severity-driven safety display)

Status: **Approved, in build** (branch `feat/floating-agent`). Traces to the deferred
"Tier-1 conversational response formatting" item and the reviewer's readability feedback.
Governed by `.claude/rules/verification-gate.md`, `.claude/rules/provenance-and-grounding.md`,
`.claude/rules/orchestrator-only.md`.

## Problem

The answer body reads as robotic repetition. It is built by joining the model's atomic
`{statement, sourceRefs}` claims with a single space (`graph.ts` `respond`:
`kept.map(c => c.statement).join(" ")`). For an enumeration ("what are the active
medications?") the model emits one sentence per item — "Lisinopril is an active
medication. Metformin is an active medication. …" — which concatenate into a wall of
near-identical sentences.

Separately, every answer renders **all** constraint findings as always-on chips of equal
weight, plus a verdict line and an ungrounded note. A safety-critical `warning` (e.g. an
allergy contraindication) gets the same visual weight as an `info` note, and the panel
feels cluttered.

The claims are the **verified data model**; the answer text is a **view** over them. The
fix is a smarter view — the atomic claims (and therefore the citation + grounding +
constraint gate) are unchanged.

## Behavior

### Grouped claims (the enumeration fix)

- The claim schema gains an **optional `group` field** (a short section header string,
  e.g. `"Active medications"`). It is metadata for rendering only — the citation check,
  grounding judge, and constraint engine ignore it entirely.
- The generate prompt instructs: when the answer enumerates items of one kind
  (medications, allergies, problems, immunizations), set `group` to a short header and
  make each claim's `statement` the **item alone** (e.g. `"Lisinopril 10 mg"`), **not** a
  full sentence repeating the category, and **not** repeating a status the header already
  states (`"Active medications"` → items don't each say "— active"). For a single fact or a
  reasoning answer, leave `group` unset and write a normal sentence.
- A pure `renderAnswerBody(claims)` function composes the body:
  - Claims **without** a group are joined with a space into a prose paragraph (identical
    to today's behavior — no regression for single-fact / reasoning answers).
  - A group with **2+ items** is bucketed by group (first-appearance order) and rendered as
    a titled bullet list in lightweight markdown: `**{group}**\n- {statement}\n- …`.
  - A group with a **single item** renders **inline** as `**{group}:** {statement}` — a
    one-item bullet list is noise; state it as a sentence.
  - A trailing status the header already conveys (e.g. `— active` under an "Active
    medications" header) is **stripped** per item (only when the header contains that status
    word), so status isn't said twice.
  - When both prose and groups are present, the prose paragraph leads, then the group
    blocks, separated by blank lines.
- Each item stays its **own atomic, individually-cited claim** — per-item provenance is
  preserved; grouping is purely presentational.

### Severity-driven safety display (the clutter fix)

Prominence is driven by finding **severity**, not treated uniformly:

- **`warning` findings** (contraindication, med-status conflict, allergy-unknown-before-
  prescribe, duplicate therapy): rendered as an **always-visible banner pinned above the
  answer body**, so it is the first thing the physician sees. Never hidden behind a hover
  or collapse. This upholds the verification-gate rule ("never a silent drop").
- **`info` findings**: demoted to a **click-to-expand disclosure** (`ℹ N clinical note(s)`)
  below the answer — present and one interaction away, but not competing with the answer.
- **Verdict**: a small always-present badge (`✓ cited & verified` / `⚠ could not fully
  verify`).
- **Ungrounded note** ("N statement(s) could not be verified…"): kept, subtle, below the
  verdict.

### Widget rendering

- The bot bubble renders the answer body as **minimal, sanitized markdown**: `**bold**`
  headers, `- ` bullets, blank-line paragraph breaks. All statement text is HTML-escaped
  before insertion (defense-in-depth — it is our own model output, but still untrusted at
  the DOM boundary).
- During SSE streaming the raw text is shown (transient); the markdown render happens on
  the `done` event, alongside the banner/disclosure restructure.

## Boundaries

- **No change to the verification gate, the `/chat` contract fields, or the authz model.**
  `group` is additive and ignored by every gate layer. The SSE `done` payload already
  carries `findings` (with `severity`) and `ungrounded`; the widget restructures how it
  renders them — no new fields required.
- **The appended, deterministic "Safety flags" text section stays in `answer`** (for the
  full-page fallback + evals, which read the raw text). The widget strips it (`bodyOf`)
  and renders warnings from the structured `findings` instead — unchanged split.
- The grouping mechanism is **(b) optional `group` on the claim** — chosen over
  prompt-only (loses per-item provenance) and a deterministic type-inferring renderer
  (couples respond to fact shapes).
- Rendering logic lives in **pure modules with their own unit tests** (`renderAnswerBody`),
  not inside a LangGraph node (`orchestrator-only` rule). The widget JS is verified live in
  the browser (no JS harness for the injected widget).

## Acceptance criteria

1. `renderAnswerBody([])`-equivalent path degrades to the standard "can't confirm" body
   (respond keeps the empty-claims → `DEGRADED_ANSWER` branch).
2. Claims with **no** `group` render exactly as today (space-joined prose) — existing
   graph/eval token assertions still pass.
3. Claims sharing a `group` render as a single `**header**` + `- item` bullet block, with
   each item's statement carrying no repeated category text.
4. Mixed grouped + ungrouped claims render prose-first, then group blocks.
5. The citation check, grounding judge, and constraint engine produce identical results
   whether or not `group` is set (group is inert to the gate).
6. In the widget, a `warning` finding appears as a banner **above** the answer text; an
   `info` finding appears only inside the expandable `ℹ notes` disclosure.
7. The widget renders `**bold**` and `- ` bullets as HTML (`<strong>`, `<ul><li>`), with
   statement text HTML-escaped.
8. Evals (`pnpm eval`, `pnpm eval:safety`) remain green — the `Safety flags` section,
   drug names, and "treat as unknown" framing are all still present in `answer`.

## Open questions

- Should the group header order follow a fixed clinical priority (problems → meds →
  allergies → immunizations) rather than model-emission order? Deferred: first-appearance
  order is predictable and the model already emits a sensible order. Revisit if ordering
  reads oddly in practice.
