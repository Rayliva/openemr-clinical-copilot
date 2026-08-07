# Spec — Document page zoom/pan in the review renderer (W2)

**Status:** building.
Extends the shared review renderer `interface/modules/custom_modules/oe-module-copilot/public/review-render.js`
(used by both `review.php` and the in-chart `review-widget.php` modal). Client-side only — no write
path, no new endpoint, no server change.

## Problem

The document-review page shows a rasterized page image with each extracted value's OCR bounding box
overlaid. At fit-to-column size the boxes are visible but the underlying text they outline is often too
small to actually read, so the physician cannot verify *what* a box is enclosing. There is no way to
zoom in.

## Behavior

Add zoom + pan to the page-image pane:

- **Zoom controls:** a small toolbar above the image with **−**, a **live % level**, **+**, and a
  **reset** button.
- **Scroll-to-zoom:** wheeling over the image zooms in/out, anchored at the cursor (the point under the
  cursor stays put).
- **Drag-to-pan:** pressing and dragging on the image pans it (grab/grabbing cursor); scrollbars also
  pan.
- **Click-a-row-to-zoom-to-its-box:** clicking a value row zooms in and centers that value's bounding
  box, then flashes the box so it is obvious which one. Clicking the row's value input or its
  accept/discard controls does **not** trigger zoom (editing still works).
- **Boxes track the zoom** automatically — they are `[0,1]`-normalized to the page, so scaling the page
  scales the boxes with it. Row↔box hover highlighting continues to work.

## Boundaries

- No change to extraction, the commit/write path, or any endpoint. Pure presentation.
- Zoom is per-document-card, local state; nothing persists.
- Degrades cleanly: a card with no page image renders exactly as before (no toolbar, no wiring).
- Works identically in the standalone review page and the in-chart modal (logic lives once in the
  shared renderer).

## Acceptance criteria

- **AC1** With a page image present, the toolbar renders and the level reads `100%` at rest.
- **AC2** `+` / `−` / wheel change the zoom within bounds (min 100%, max ~600%); the level updates and
  the image + boxes scale together.
- **AC3** Wheel zoom keeps the point under the cursor stationary.
- **AC4** Dragging pans the image when zoomed; reset returns to 100% at the top-left.
- **AC5** Clicking a row that has a box zooms in and centers/flashes that box.
- **AC6** Clicking a row's value input or accept/discard buttons does not zoom.
- **AC7** A card with no page image renders unchanged (no toolbar, no errors).

## Verification

No JS test harness exists for the module's browser code, so verify visually: render a card with a stub
draft (a sample page image + a couple of normalized boxes) in a throwaway HTML harness and drive the
dev stack's Selenium/Panther to screenshot at 100% and zoomed, confirming the boxes track. Screenshots
Read back inline.
