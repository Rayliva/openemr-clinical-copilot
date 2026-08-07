# Spec — answer icon bar (chat UI polish)

Status: implemented (index.php). Client-only presentation change to the embedded chat page
(`interface/modules/custom_modules/oe-module-copilot/public/index.php`). No server/agent
change — it re-renders the SAME `/chat` done-frame data (`findings`, `citations`, `ungrounded`,
`withheld`). Governed by the repo-root standards (module PHP/JS), not the sidecar rules.

## Why
The answer bubble previously appended every deterministic annotation as always-visible text /
chips: safety warnings, info "clinical notes", ungrounded/withheld notes, and (unrendered)
sources. It cluttered the answer and made a safe refusal read like a shrug. Collapse the
annotations into a compact **icon bar at the bottom of each bot message**; each icon expands
its detail on click. Cleaner, and it keeps the answer text the focus.

## Behavior
- The answer body renders on top (unchanged), stripped of the server's appended sections.
- Below it, a row of pill icons — one per non-empty category, hidden when its count is 0:
  - **⚠ warnings** (`findings` with `severity==="warning"`) — red pill + count.
  - **ℹ notes** (`findings` with `severity!=="warning"` + the `ungrounded` note + the `withheld`
    note) — grey pill + count.
  - **📄 sources** (guideline `citations[].sources` with `kind==="guideline"`, deduped by ref) —
    green pill + count.
- Clicking a pill opens a single shared panel showing that category's lines; clicking the active
  pill (or another) toggles/switches. One panel open at a time.
- **Safety exception:** if there is ≥1 warning, the warnings panel is **auto-opened** on render —
  a documented contraindication/med-conflict must never be hidden behind a click
  (`verification-gate`, `provenance-and-grounding`). Notes + sources stay collapsed. In the common
  case (no warnings) the bar is fully collapsed → clean.
- Withheld/ungrounded text is never echoed — only the count + reason (matches the server body
  treatment; the withheld statement is the content the gate rejected).

## Boundaries
- No change to what the server sends or the gate; purely how the done-frame is displayed.
- Model/finding text is HTML-escaped before insertion (no markup injection at the DOM boundary).
- The floating in-chart widget (`widget.php`) already collapses notes/sources into `ℹ`/`📄`
  disclosures and shows warnings in a loud top banner; unifying it to this same bar is a
  follow-on, not in this change.

## Acceptance criteria
- **AC1** No findings/notes/sources → no icon bar; just the answer.
- **AC2** A warning finding → a red `⚠ 1` pill AND its panel auto-opened showing the message.
- **AC3** Info findings + a withheld note → an `ℹ` pill whose panel lists both (withheld shows
  reason + "does not recommend treatment or doses", never the statement).
- **AC4** A guideline-cited answer → a `📄` pill whose panel shows the passage(s) with doc/section.
- **AC5** Clicking a pill toggles its panel; the answer text is never obscured.
