# Spec — inline source viewer in the chat (W2)

## Problem
When the agent grounds an answer in a source, the physician can see *that* it's cited (the "Sources"
line) but not *what* the source shows. She should be able to click a citation and expand it in place —
like the existing "clinical notes" `<details>` in the chat — to see the evidence:
- a **cited guideline passage** as text (the RAG corpus is markdown — no image), or
- a **patient document** (lab PDF / intake form) as a page screenshot with a **bounding box** around
  the referenced value, exactly like the document-review viewer.

## Behavior (observable)
In the chat panel (`widget.php`), each answer's grounded citations render with a **"View source"**
affordance. On expand:
- **Guideline-backed claim** → shows the cited chunk's text passage + its `{doc, section}` label.
- **Ingested-document-derived value** (a lab/intake value that was extracted from an uploaded PDF and
  committed) → shows the document **page image with the value's bounding box** overlaid, reusing the
  review-viewer overlay.
- **Plain chart value** (typed directly, no source document) → no image button; the citation still
  shows its provenance label (source table/row), unchanged from today.
- Absence/degraded answers are unchanged.

## Boundaries (does NOT do)
- **Read-only** — no new writes; nothing is re-committed. Re-extraction only re-renders + re-locates.
- **Owned pid only** — every fetch is scoped to the bound session pid (`authorization-and-pid-scope`).
- **No schema change** — the bounding box is NOT persisted; it is re-derived on demand from the source
  PDF via the existing ingestion pipeline (physician chose "re-extract on click"). The cached draft
  (Redis, extract-once) is reused when present, so a second click is instant.
- **No new source of truth** — guideline text comes from the committed corpus; the box from the live PDF.

## Data flow
1. **Agent enriches the citation payload** (`/chat` done frame). Today: `citations:[{statement,sourceRefs[]}]`
   (opaque ids). New: each source is tagged with its kind + the data the widget needs:
   - guideline chunk → `{kind:"guideline", ref, doc, section, text}` (the agent already holds the
     `EvidenceSnippet` for every retrieved chunk — `evidence`/`evidenceIndex` in graph state).
   - chart row → `{kind:"chart", ref, sourceTable}` (the agent does NOT know if it's document-derived;
     it carries only provenance — resolution happens module-side).
2. **Module resolves a chart citation → source document** (PHP, has DB access; the agent does not carry
   `derivedFrom`). Given the observation uuid → `SELECT ob_documentationof_table_id FROM form_observation
   WHERE uuid=? AND ob_documentationof_table='documents'` → `documentId` (+ the value/code to locate).
   Only derived-from-document rows resolve; others return "no document".
3. **Fetch the page image + box** for that value: reuse `POST /documents/pending` (returns drafts with
   page rasters + per-value boxes; committed docs are still detected, so their draft is retrievable) or a
   focused `documentId`-scoped variant; the widget matches the cited value to its located result → box.
4. **Widget renders** the expander: guideline → text; document → `review-render.js` overlay (page image +
   the one box), scoped to the referenced value.

## Slices
- **Slice A — guideline "view source" (agent + widget; offline-testable):** agent includes the cited
  guideline snippet text in the done frame; widget renders an expandable passage. No PHP, no re-extract.
- **Slice B — document image+box "view source" (agent kind-tag + PHP resolve + widget overlay; live-verify
  on Site B):** module observation→document resolver endpoint; widget "View source" button → fetch draft →
  overlay the box for the value.

## Acceptance criteria
- **A1:** an answer citing a guideline chunk renders a "View source" that expands to the chunk's text +
  `{doc, section}`; a chart-only answer shows no guideline passage. (agent unit test on the done payload +
  widget render.)
- **A2:** the enriched citation payload never leaks a dropped/ungrounded claim (only `groundedClaims`), and
  carries no PHI beyond what the answer already shows. (agent test — extends the existing leak test.)
- **B1:** given a lab value derived from an uploaded PDF, the module resolves its observation uuid → the
  correct `documentId`; a directly-entered value resolves to "no document". (PHP unit test on the resolver.)
- **B2:** clicking "View source" on that value expands the page image with a box around the value, matching
  the review viewer; second click is instant (cached). (live-verify on Site B.)
- **B3:** re-extraction is read-only + owned-pid-scoped; no commit, no cross-patient document. (guardrails.)

## Open items
- Confirm the agent's `getLabs` surfaces derived `form_observation` labs (category=laboratory) so they are
  citeable at all — a prerequisite for Slice B; verify against Site B during B.
- Whether to add a `documentId`-scoped draft endpoint vs reusing `POST /documents/pending` (decide in B).
