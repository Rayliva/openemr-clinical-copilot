# Spec — Shared zoom/pan for the fullscreen source viewer (trends + chat)

Status: in progress · Traces to: UC-2/UC-3 usability; PDF Core Deliverables "Click-to-source
UI + document preview". Extends `w2-document-zoom.md` (the reviewer's zoom/pan).

## Problem

The document **reviewer** (`review-render.js` `wireZoom`) has rich page navigation — wheel-zoom
anchored at the cursor, drag-to-pan, +/−/reset, and click-a-row to zoom to its box. The
**fullscreen source viewer** the chat "View source document" and the **trends** click-a-point
open (`widget.php` `openLightbox`) has only a coarse click-to-step-zoom. The physician cannot
pan or scroll-zoom the source there. The two should feel the same.

## Behavior

Extract the reviewer's pan/zoom into a reusable `attachZoomPan` and drive the lightbox with it:

- **Scroll wheel** zooms toward the cursor.
- **Drag** pans (grab / grabbing cursor).
- On open, the viewer **zooms to the cited value's bounding box** (so the physician lands on the
  number that was cited), when a box is present.
- **Double-click** zooms a step toward the cursor; a single click on the page does **not** close
  the viewer (only the dark backdrop / × / Esc close it).
- Reviewer behavior is unchanged (same `attachZoomPan` now backs `wireZoom`).

## Boundaries

- Read-only: the viewer draws the page image + boxes; it never writes.
- One implementation: `attachZoomPan` lives in `review-render.js` (`window.CopilotReview`) and is
  reused by `widget.php`; no duplicated pan/zoom math. `widget.php` degrades gracefully (keeps a
  basic zoom) if `CopilotReview.attachZoomPan` is unavailable.
- No change to the box-match, the source-resolver, or the drafts payload.

## Acceptance criteria

1. `CopilotReview.attachZoomPan({wrap, inner, img, ...})` returns `{apply, reset, focusBox,
   getZoom}` and wires wheel-zoom-at-cursor, drag-pan, and optional +/−/reset buttons.
2. `wireZoom` (reviewer) is refactored onto `attachZoomPan` with identical behavior (wheel/drag/
   buttons/row-click-to-box still work).
3. The lightbox opens focused on the cited value's box (when boxed), supports wheel-zoom, drag-pan,
   and double-click-zoom; a click on the page does not close it; backdrop/×/Esc still close.
4. Trends: click a data point → fullscreen source opens with the same navigation.
5. Verified in a real browser (headless Chrome via the dev Selenium/Panther path or manual).

## Open questions

None.
