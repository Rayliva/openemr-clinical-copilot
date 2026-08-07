/**
 * Shared Clinical Co-Pilot document-review renderer. Turns one ingestion draft (from the agent's
 * POST /documents/pending) into a DOM card: the page image with each extracted value's OCR bounding
 * box overlaid, beside a values/flags/confidence/match-state table, with row<->box hover highlighting.
 * Used by both the standalone review page (review.php) and the in-chart review modal
 * (review-widget.php) so the rendering lives in exactly one place. Read-only — draws drafts, never
 * writes. Exposed as window.CopilotReview.
 *
 * @package OpenEMR
 * @license https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */
window.CopilotReview = (function () {
  "use strict";

  // Inject the renderer's styles once, so any host page (review.php, the in-chart modal) that uses
  // renderDoc gets the layout without duplicating CSS.
  function injectStylesOnce() {
    if (document.getElementById("cpr-styles")) { return; }
    // Light theme matching the OpenEMR (Bootstrap 4) shell: white surfaces, #212529 body text,
    // blue (#0d6efd) headings/labels/accents, the OpenEMR/Bootstrap sans-serif font stack.
    var FONT = 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif';
    var css = [
      ".cpr-doc{background:#fff;border:1px solid #dee2e6;border-radius:8px;margin:0 0 16px;overflow:hidden;color:#212529;" + FONT + "}",
      ".cpr-h{font-size:15px;margin:0;padding:10px 14px;border-bottom:1px solid #dee2e6;display:flex;gap:10px;align-items:center;color:#0d6efd;font-weight:600}",
      ".cpr-pill{font-size:11px;padding:2px 8px;border-radius:20px}",
      ".cpr-pill.ok{background:#d1e7dd;color:#0f5132}.cpr-pill.degraded{background:#fff3cd;color:#664d03}",
      ".cpr-when{color:#6c757d;font-size:12px;font-weight:400}",
      ".cpr-grid{display:grid;grid-template-columns:minmax(300px,1fr) minmax(280px,1fr);gap:0}",
      "@media(max-width:760px){.cpr-grid{grid-template-columns:1fr}}",
      ".cpr-pagecol{display:flex;flex-direction:column;min-width:0;border-right:1px solid #dee2e6}",
      ".cpr-pagecol-standalone{border-right:none;border:1px solid #dee2e6;border-radius:8px;overflow:hidden}",
      ".cpr-zoombar{display:flex;align-items:center;gap:6px;padding:6px 10px;background:#f1f3f5;border-bottom:1px solid #dee2e6}",
      ".cpr-zbtn{width:26px;height:24px;border:1px solid #ced4da;border-radius:5px;background:#fff;cursor:pointer;font-size:14px;line-height:1;color:#0d6efd;padding:0}",
      ".cpr-zbtn:hover{background:#e7f1ff}",
      ".cpr-zlevel{font-variant-numeric:tabular-nums;color:#495057;font-size:12px;min-width:44px;text-align:center}",
      ".cpr-zhint{color:#6c757d;font-size:11px;margin-inline-start:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".cpr-pagewrap{background:#f8f9fa;padding:10px;overflow:auto;max-height:70vh}",
      ".cpr-pagewrap.cpr-zoomable{cursor:grab}.cpr-pagewrap.cpr-grabbing{cursor:grabbing;user-select:none}",
      ".cpr-pageinner{position:relative;display:inline-block}",
      ".cpr-pageinner img{display:block;max-width:100%;height:auto;border:1px solid #dee2e6}",
      ".cpr-box{position:absolute;border:2px solid rgba(13,110,253,.55);background:rgba(13,110,253,.10);border-radius:2px;pointer-events:none;transition:border-color .1s,background .1s}",
      ".cpr-box.on{border-color:#fd7e14;background:rgba(253,126,20,.22)}",
      ".cpr-row.cpr-hasbox{cursor:zoom-in}",
      ".cpr-tablewrap{overflow:auto;max-height:70vh}",
      ".cpr-table{width:100%;border-collapse:collapse}",
      ".cpr-table th,.cpr-table td{text-align:left;padding:7px 10px;border-bottom:1px solid #dee2e6;font-size:13px;vertical-align:top}",
      ".cpr-table th{color:#0d6efd;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.4px}",
      ".cpr-row:hover{background:#f1f6ff}",
      ".cpr-val{font-weight:600;color:#212529}",
      ".cpr-flag{font-size:11px;padding:1px 7px;border-radius:20px}",
      ".cpr-flag.high,.cpr-flag.critical,.cpr-flag.abnormal,.cpr-flag.low{background:#f8d7da;color:#842029}",
      ".cpr-flag.normal{background:#d1e7dd;color:#0f5132}.cpr-flag.unknown{background:#e2e3e5;color:#41464b}",
      ".cpr-conf{font-variant-numeric:tabular-nums;color:#495057}",
      ".cpr-match{font-size:11px;color:#6c757d}.cpr-match.unverified{color:#997404}.cpr-match.approximate{color:#997404}",
      ".cpr-issues{padding:14px;color:#842029}.cpr-issues li{margin:4px 0}",
      ".cpr-note{padding:8px 14px;color:#6c757d;font-size:12px;border-top:1px solid #dee2e6}",
      ".cpr-status{padding:16px;color:#6c757d}",
      ".cpr-vedit{width:88px;font:inherit;padding:2px 5px;border:1px solid #ced4da;border-radius:4px;color:#212529;background:#fff}",
      ".cpr-vedit:disabled{background:#f1f3f5;color:#868e96}",
      ".cpr-decide{display:inline-flex;gap:4px}",
      ".cpr-dbtn{width:28px;height:24px;border:1px solid #ced4da;border-radius:5px;background:#fff;cursor:pointer;font-size:13px;line-height:1;color:#6c757d;padding:0}",
      ".cpr-dbtn:hover{background:#f1f6ff}",
      ".cpr-acc.on{background:#0f5132;border-color:#0f5132;color:#fff}",
      ".cpr-disc.on{background:#842029;border-color:#842029;color:#fff}",
      ".cpr-row.cpr-accepted{background:#eaf6ee}",
      ".cpr-row.cpr-discarded{opacity:.5}.cpr-row.cpr-discarded td{text-decoration:line-through}",
      ".cpr-onchart{font-size:11px;color:#0f5132;font-weight:600;white-space:nowrap}",
      ".cpr-dismissed{font-size:11px;color:#842029;font-weight:600;white-space:nowrap}",
      ".cpr-corrected{font-size:11px;color:#997404;white-space:nowrap}",
      ".cpr-commitbar{padding:10px 14px;border-top:1px solid #dee2e6;display:flex;gap:10px;align-items:center;flex-wrap:wrap}",
      ".cpr-commit{background:#0d6efd;color:#fff;border:none;border-radius:6px;padding:7px 14px;font:inherit;font-weight:600;cursor:pointer}",
      ".cpr-commit:hover{background:#0b5ed7}.cpr-commit:disabled{opacity:.55;cursor:default}",
      ".cpr-bulk{background:#fff;color:#0d6efd;border:1px solid #0d6efd;border-radius:6px;padding:6px 12px;font:inherit;cursor:pointer}",
      ".cpr-bulk:hover{background:#f1f6ff}",
      ".cpr-commitmsg{font-size:13px;color:#495057}",
      ".cpr-res-written{color:#0f5132;font-weight:600}.cpr-res-skipped{color:#664d03;font-weight:600}.cpr-res-rejected{color:#842029;font-weight:600}"
    ].join("");
    var style = document.createElement("style");
    style.id = "cpr-styles";
    style.textContent = css;
    document.head.appendChild(style);
  }

  // Attribute-safe HTML escape (escapes quotes too) — every extracted value passes through this.
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Boxes are [0,1]-normalized to the page, so percentage positioning needs no pixel dimensions.
  function boxStyle(b) {
    return "left:" + b.x * 100 + "%;top:" + b.y * 100 + "%;width:" + b.w * 100 + "%;height:" + b.h * 100 + "%";
  }

  // Build a DOM card for one draft. Returns the element (caller appends it).
  // Optional `commit` config enables the physician write path (slice 2f): { moduleBase, csrf }. When
  // present, each row gains Accept (✓) / Discard (✗) controls + an editable value, and a Commit button
  // POSTs the accepted values to the module's commit-review endpoint. Absent → read-only (the default).
  function renderDoc(doc, commit) {
    injectStylesOnce();
    var canCommit = !!(commit && commit.moduleBase);
    // Saved per-value dispositions keyed by value key (from the module on reopen); {} on first open.
    var decisions = (commit && commit.decisions) || {};
    var el = document.createElement("div");
    el.className = "cpr-doc";
    var pill = doc.status === "ok"
      ? '<span class="cpr-pill ok">extracted</span>'
      : '<span class="cpr-pill degraded">needs review</span>';
    var when = doc.date ? ' &middot; ' + esc(doc.date) : "";
    var head = '<h3 class="cpr-h">' + esc(doc.title || "Document") + pill + '<span class="cpr-when">' + when + "</span></h3>";

    if (doc.status !== "ok") {
      var issues = (doc.issues || []).map(function (i) { return "<li>" + esc(i) + "</li>"; }).join("");
      el.innerHTML = head + '<div class="cpr-issues"><div>Could not extract a valid result set — flagged for manual review:</div><ul>' + issues + "</ul></div>";
      return el;
    }

    var results = doc.results || [];
    var boxes = results.map(function (r, i) {
      return r.box ? '<div class="cpr-box" data-i="' + i + '" style="' + boxStyle(r.box) + '"></div>' : "";
    }).join("");
    var img = doc.pageImageBase64
      ? '<div class="cpr-pageinner"><img alt="document page" src="data:' + esc(doc.pageMediaType || "image/png") + ";base64," + esc(doc.pageImageBase64) + '"/>' + boxes + "</div>"
      : '<div class="cpr-status">No page image.</div>';

    var decideTh = canCommit ? "<th>Decision</th>" : "";
    var rows = results.map(function (r, i) {
      var flag = esc(r.abnormalFlag || "unknown");
      var match = esc(r.matchState || "");
      var conf = typeof r.confidence === "number" ? Math.round(r.confidence * 100) + "%" : "";
      var noBox = r.box ? "" : ' &middot; <span class="cpr-match unverified">no box — verify</span>';
      // The value's SAVED disposition, if any — so reopening shows on-chart / dismissed state instead
      // of a blank slate. key matches the write path (LOINC:<loinc> | testName).
      var key = r.loinc ? ("LOINC:" + r.loinc) : r.testName;
      var decided = decisions[key];
      var dispo = decided ? decided.disposition : "";                  // 'accepted' | 'discarded' | ''
      var initDecision = dispo === "accepted" ? "accept" : dispo === "discarded" ? "discard" : "";
      var shownValue = dispo === "accepted" ? decided.value : r.value;  // show the committed value on reopen
      var corrected = dispo === "accepted" && String(decided.value) !== String(r.value);
      var stateTag = dispo === "accepted"
        ? ' <span class="cpr-onchart">&#10003; on chart</span>' + (corrected ? ' <span class="cpr-corrected">AI read ' + esc(r.value) + "</span>" : "")
        : dispo === "discarded" ? ' <span class="cpr-dismissed">dismissed</span>' : "";
      var decideTd = canCommit
        ? '<td><div class="cpr-decide">'
          + '<button type="button" class="cpr-dbtn cpr-acc' + (initDecision === "accept" ? " on" : "") + '" data-i="' + i + '" title="Accept — write this value to the chart">&#10003;</button>'
          + '<button type="button" class="cpr-dbtn cpr-disc' + (initDecision === "discard" ? " on" : "") + '" data-i="' + i + '" title="Discard — do not write this value">&#10007;</button>'
          + "</div></td>"
        : "";
      var valueCell = canCommit
        ? '<input class="cpr-vedit" data-i="' + i + '" value="' + esc(shownValue) + '" data-original="' + esc(r.value) + '"' + (initDecision === "discard" ? " disabled" : "") + "> " + esc(r.unit || "") + stateTag
        : '<span class="cpr-val">' + esc(r.value) + "</span> " + esc(r.unit || "");
      var rowState = initDecision === "accept" ? " cpr-accepted" : initDecision === "discard" ? " cpr-discarded" : "";
      return '<tr class="cpr-row' + (r.box ? " cpr-hasbox" : "") + rowState + '" data-i="' + i + '" data-decision="' + initDecision + '">'
        + decideTd
        + "<td>" + esc(r.testName) + "</td>"
        + "<td>" + valueCell + "</td>"
        + '<td><span class="cpr-flag ' + flag + '">' + flag + "</span></td>"
        + '<td class="cpr-conf">' + conf + "</td>"
        + '<td><span class="cpr-match ' + match + '">' + match + "</span>" + noBox + "</td>"
        + "</tr>";
    }).join("");

    var noteText = canCommit
      ? "Accept (✓) each value to write to the chart, or Discard (✗) the ones to reject; edit any that are wrong (recorded physician-corrected). Nothing is written until you commit — accepted values become cited Observations."
      : "Boxes show where each value was located on the page. Hover a row to highlight its box. Nothing is written to the chart — this is review only.";
    var commitBar = canCommit
      ? '<div class="cpr-commitbar">'
        + '<button class="cpr-commit" type="button">Commit accepted to chart</button>'
        + '<button class="cpr-bulk cpr-all-acc" type="button">Accept all</button>'
        + '<button class="cpr-bulk cpr-all-disc" type="button">Discard all</button>'
        + '<span class="cpr-commitmsg">Nothing writes until you commit.</span></div>'
      : "";

    // Zoom toolbar (only when there's a page image to zoom). Wired in wireZoom.
    var zoombar = doc.pageImageBase64
      ? '<div class="cpr-zoombar">'
        + '<button type="button" class="cpr-zbtn cpr-zout" title="Zoom out">&minus;</button>'
        + '<span class="cpr-zlevel">100%</span>'
        + '<button type="button" class="cpr-zbtn cpr-zin" title="Zoom in">+</button>'
        + '<button type="button" class="cpr-zbtn cpr-zreset" title="Reset zoom">&#8634;</button>'
        + '<span class="cpr-zhint">scroll to zoom &middot; drag to pan &middot; click a row to zoom to its box</span>'
        + "</div>"
      : "";

    el.innerHTML = head
      + '<div class="cpr-grid"><div class="cpr-pagecol">' + zoombar + '<div class="cpr-pagewrap">' + img + "</div></div>"
      + '<div class="cpr-tablewrap"><table class="cpr-table"><thead><tr>' + decideTh + '<th>Test</th><th>Value</th><th>Flag</th><th>Conf.</th><th>Source</th></tr></thead><tbody>'
      + rows + "</tbody></table>"
      + '<div class="cpr-note">' + noteText + "</div></div></div>"
      + commitBar;

    // Row <-> box highlighting is wired inside wireZoom so hover and click-to-zoom share ONE
    // "active box" — exactly one orange box at a time (never the clicked box AND a hovered box).
    wireZoom(el, results);
    if (canCommit) { wireCommit(el, doc, results, commit); }
    return el;
  }

  // Generic pan/zoom for a page image inside a scroll container — the ONE implementation shared by
  // the review card (wireZoom) and the fullscreen source viewer in widget.php. The image width is
  // scaled in px (boxes are %-positioned children, so they track); the overflow:auto `wrap` provides
  // scrollbars + drag panning. opts: {wrap, inner, img, levelEl?, min?, max?, zin?, zout?, zreset?}.
  // Returns { apply, reset, focusBox, getZoom }. No-op (safe stub) if wrap/inner/img are missing.
  function attachZoomPan(opts) {
    var wrap = opts.wrap, inner = opts.inner, img = opts.img;
    var noop = { apply: function () {}, reset: function () {}, focusBox: function () {}, getZoom: function () { return 1; } };
    if (!wrap || !inner || !img) { return noop; }
    var MIN = opts.min || 1, MAX = opts.max || 6;
    var zoom = 1;
    var base = 0; // fitted CSS width (px) at zoom 1; computed lazily once the image is laid out
    var levelEl = opts.levelEl || null;
    wrap.classList.add("cpr-zoomable");

    function ensureBase() {
      if (base > 0) { return base; }
      var w = img.clientWidth || img.getBoundingClientRect().width;
      if (w > 0) { base = w; }
      return base;
    }

    // Set the zoom, keeping the content point under `anchor` (client x/y) stationary; centered when
    // no anchor is given.
    function apply(nextZoom, anchor) {
      var b = ensureBase();
      if (!(b > 0)) { return; }
      nextZoom = Math.max(MIN, Math.min(MAX, nextZoom));
      var rect = wrap.getBoundingClientRect();
      var ax = anchor ? (anchor.x - rect.left) : rect.width / 2;
      var ay = anchor ? (anchor.y - rect.top) : rect.height / 2;
      var oldW = inner.offsetWidth || (b * zoom);
      var oldH = inner.offsetHeight || 1;
      var rx = (wrap.scrollLeft + ax) / oldW;
      var ry = (wrap.scrollTop + ay) / oldH;
      zoom = nextZoom;
      img.style.maxWidth = "none";
      img.style.width = (b * zoom) + "px";
      wrap.scrollLeft = rx * inner.offsetWidth - ax;
      wrap.scrollTop = ry * inner.offsetHeight - ay;
      if (levelEl) { levelEl.textContent = Math.round(zoom * 100) + "%"; }
    }

    function reset() {
      zoom = 1; base = 0;
      img.style.width = "";
      img.style.maxWidth = "";
      wrap.scrollLeft = 0; wrap.scrollTop = 0;
      if (levelEl) { levelEl.textContent = "100%"; }
    }

    // Zoom to (at least `minZoom`) and center a [0,1]-normalized box.
    function focusBox(box, minZoom) {
      if (!box) { return; }
      apply(Math.max(zoom, minZoom || 3), null);
      wrap.scrollLeft = (box.x + box.w / 2) * inner.offsetWidth - wrap.clientWidth / 2;
      wrap.scrollTop = (box.y + box.h / 2) * inner.offsetHeight - wrap.clientHeight / 2;
    }

    if (opts.zin) { opts.zin.addEventListener("click", function () { apply(zoom * 1.4, null); }); }
    if (opts.zout) { opts.zout.addEventListener("click", function () { apply(zoom / 1.4, null); }); }
    if (opts.zreset) { opts.zreset.addEventListener("click", reset); }

    wrap.addEventListener("wheel", function (e) {
      e.preventDefault();
      apply(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), { x: e.clientX, y: e.clientY });
    }, { passive: false });

    // Drag to pan (listen on window while dragging so a fast drag doesn't drop).
    var dragging = false, moved = false, sx = 0, sy = 0, sl = 0, st = 0;
    wrap.addEventListener("mousedown", function (e) {
      if (e.button !== 0) { return; }
      dragging = true; moved = false; sx = e.clientX; sy = e.clientY;
      sl = wrap.scrollLeft; st = wrap.scrollTop;
      wrap.classList.add("cpr-grabbing");
      e.preventDefault();
    });
    window.addEventListener("mousemove", function (e) {
      if (!dragging) { return; }
      if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 3) { moved = true; }
      wrap.scrollLeft = sl - (e.clientX - sx);
      wrap.scrollTop = st - (e.clientY - sy);
    });
    window.addEventListener("mouseup", function () {
      if (!dragging) { return; }
      dragging = false; wrap.classList.remove("cpr-grabbing");
    });

    return { apply: apply, reset: reset, focusBox: focusBox, getZoom: function () { return zoom; }, movedLast: function () { return moved; } };
  }

  // Zoom + pan for the review card's page image, plus row<->box highlight + click-to-zoom. Delegates
  // all pan/zoom to the shared attachZoomPan; keeps only the reviewer-specific row/box wiring here.
  function wireZoom(el, results) {
    var pagewrap = el.querySelector(".cpr-pagewrap");
    var pageinner = el.querySelector(".cpr-pageinner");
    var img = pageinner ? pageinner.querySelector("img") : null;
    if (!pagewrap || !pageinner || !img) { return; }

    var zp = attachZoomPan({
      wrap: pagewrap, inner: pageinner, img: img,
      levelEl: el.querySelector(".cpr-zlevel"),
      zin: el.querySelector(".cpr-zin"),
      zout: el.querySelector(".cpr-zout"),
      zreset: el.querySelector(".cpr-zreset"),
      min: 1, max: 6
    });

    // Row <-> box highlighting: exactly ONE box is orange at a time. Hovering a row highlights its
    // box; moving off falls back to the last CLICKED box (the zoom anchor). Clicking a row also zooms
    // to + centers its box (editing/deciding clicks are ignored).
    var boxEls = pageinner.querySelectorAll(".cpr-box");
    var clickedIdx = null;
    function highlight(idx) {
      boxEls.forEach(function (b) {
        b.classList.toggle("on", idx !== null && b.getAttribute("data-i") === idx);
      });
    }
    el.querySelectorAll("tr.cpr-row").forEach(function (tr) {
      var i = tr.getAttribute("data-i");
      tr.addEventListener("mouseenter", function () { highlight(i); });
      tr.addEventListener("mouseleave", function () { highlight(clickedIdx); });
      tr.addEventListener("click", function (e) {
        if (e.target && e.target.closest && e.target.closest(".cpr-vedit, .cpr-decide")) { return; }
        var r = results[parseInt(i, 10)] || {};
        if (!r.box) { return; }
        clickedIdx = i;
        zp.focusBox(r.box, 3);
        highlight(i);
      });
    });
  }

  // Per-row Accept/Discard decisions + a Commit that POSTs only the accepted rows (with edits). A
  // value with a located box carries a citation; an edited value is flagged physician-corrected (the
  // write path re-enforces every gate server-side — an uncited, unedited value is rejected there too).
  function wireCommit(el, doc, results, cfg) {
    var btn = el.querySelector(".cpr-commit");
    var msg = el.querySelector(".cpr-commitmsg");
    if (!btn) { return; }

    function rowOf(i) { return el.querySelector('tr.cpr-row[data-i="' + i + '"]'); }
    function inputOf(i) { return el.querySelector('.cpr-vedit[data-i="' + i + '"]'); }

    // Set a row's decision directly to "accept" | "discard" | "" (undecided).
    function applyDecision(i, next) {
      var tr = rowOf(i);
      if (!tr) { return; }
      tr.setAttribute("data-decision", next);
      tr.classList.toggle("cpr-accepted", next === "accept");
      tr.classList.toggle("cpr-discarded", next === "discard");
      var acc = tr.querySelector(".cpr-acc");
      var disc = tr.querySelector(".cpr-disc");
      if (acc) { acc.classList.toggle("on", next === "accept"); }
      if (disc) { disc.classList.toggle("on", next === "discard"); }
      var input = inputOf(i);
      if (input) { input.disabled = next === "discard"; }
    }
    // A button click toggles its choice on/off (clicking the active one returns the row to undecided).
    function toggle(i, decision) {
      var tr = rowOf(i);
      var current = tr ? (tr.getAttribute("data-decision") || "") : "";
      applyDecision(i, current === decision ? "" : decision);
    }

    el.querySelectorAll(".cpr-acc").forEach(function (b) {
      b.addEventListener("click", function () { toggle(b.getAttribute("data-i"), "accept"); });
    });
    el.querySelectorAll(".cpr-disc").forEach(function (b) {
      b.addEventListener("click", function () { toggle(b.getAttribute("data-i"), "discard"); });
    });
    var allAcc = el.querySelector(".cpr-all-acc");
    var allDisc = el.querySelector(".cpr-all-disc");
    if (allAcc) { allAcc.addEventListener("click", function () { results.forEach(function (_, i) { applyDecision(String(i), "accept"); }); }); }
    if (allDisc) { allDisc.addEventListener("click", function () { results.forEach(function (_, i) { applyDecision(String(i), "discard"); }); }); }

    btn.addEventListener("click", function () {
      // Send EVERY row with its disposition so the endpoint persists accepts AND discards, and can
      // tell whether the document is fully reviewed (no value left undecided).
      var values = [];
      var decidedCount = 0;
      el.querySelectorAll("tr.cpr-row").forEach(function (tr) {
        var decision = tr.getAttribute("data-decision") || "";
        var disposition = decision === "accept" ? "accepted" : decision === "discard" ? "discarded" : "undecided";
        if (disposition !== "undecided") { decidedCount += 1; }
        var i = tr.getAttribute("data-i");
        var r = results[parseInt(i, 10)] || {};
        var input = inputOf(i);
        var value = input ? input.value : r.value;
        var original = input ? input.getAttribute("data-original") : r.value;
        values.push({
          testName: r.testName,
          value: value,
          unit: r.unit || null,
          loinc: r.loinc || null,
          referenceRange: r.referenceRange || null,
          citationId: r.box ? (doc.documentId + "#" + i) : "",
          disposition: disposition,
          physicianCorrected: value !== original
        });
      });
      if (!decidedCount) { msg.textContent = "Accept (✓) or discard (✗) at least one value first."; return; }
      btn.disabled = true;
      msg.textContent = "Committing…";
      // Fetch a CSRF token for the CURRENT session first: the page's token goes stale if OpenEMR
      // rotated the session id since load (→ "csrf verification failed"). Fall back to the page token
      // if the refresh fails (the defensive parse below then surfaces a clear session message).
      fetch(cfg.moduleBase + "/public/csrf.php", { credentials: "same-origin" })
        .then(function (r) { return r.ok ? r.json().catch(function () { return null; }) : null; })
        .then(function (ct) {
          var csrf = (ct && ct.csrf) || cfg.csrf;
          return fetch(cfg.moduleBase + "/public/commit-review.php", {
            method: "POST", credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ csrf_token_form: csrf, documentId: doc.documentId, collectionDate: doc.date || null, values: values })
          });
        }).then(function (r) {
        // Parse DEFENSIVELY: OpenEMR's globals.php returns an EMPTY-bodied 400 when the session is
        // invalid/expired (before this controller runs), so a blind r.json() throws the cryptic
        // "Unexpected end of JSON input". Read text, try JSON, and surface an actionable message.
        return r.text().then(function (t) {
          var j = null;
          if (t) { try { j = JSON.parse(t); } catch (e) { j = null; } }
          if (!r.ok) {
            if (!j && (r.status === 400 || r.status === 401 || r.status === 403)) {
              throw new Error("your OpenEMR session may have expired — reload the page and try again.");
            }
            throw new Error((j && j.error) || ("HTTP " + r.status));
          }
          if (!j) { throw new Error("unexpected empty response (HTTP " + r.status + ")"); }
          return j;
        });
      }).then(function (res) {
        msg.innerHTML = "Wrote <span class='cpr-res-written'>" + res.written + "</span>"
          + (res.superseded ? ", updated <span class='cpr-res-written'>" + res.superseded + "</span> (superseded prior)" : "")
          + ", skipped <span class='cpr-res-skipped'>" + res.skipped + "</span> (already on chart)"
          + ", rejected <span class='cpr-res-rejected'>" + res.rejected + "</span>"
          + (res.discarded ? ", dismissed " + res.discarded : "")
          + (res.reviewed ? " — document reviewed ✓" : "") + ".";
        btn.disabled = false;
      }).catch(function (e) {
        msg.textContent = "Commit failed: " + e.message;
        btn.disabled = false;
      });
    });
  }

  // A self-contained, IN-PLACE zoomable page viewer: the document page image with its OCR boxes,
  // a zoom toolbar, and scroll-to-zoom / drag-to-pan — the SAME behavior as the review page's page
  // column, but standalone (no values table / commit). Used by the chat + trends source viewers so
  // the physician zooms/pans the PDF where it sits rather than opening a fullscreen lightbox.
  // `hotValue` (optional) highlights + zooms to the cited value's box on open. Returns the element.
  function renderZoomablePage(doc, hotValue) {
    injectStylesOnce();
    var el = document.createElement("div");
    el.className = "cpr-pagecol cpr-pagecol-standalone";
    if (!doc || !doc.pageImageBase64) {
      el.innerHTML = '<div class="cpr-status">No page image for this document.</div>';
      return el;
    }
    var results = doc.results || [];
    var boxes = results.map(function (r, i) {
      if (!r.box) { return ""; }
      var on = (hotValue != null && String(r.value) === String(hotValue)) ? " on" : "";
      return '<div class="cpr-box' + on + '" data-i="' + i + '" style="' + boxStyle(r.box) + '"></div>';
    }).join("");
    var zoombar = '<div class="cpr-zoombar">'
      + '<button type="button" class="cpr-zbtn cpr-zout" title="Zoom out">&minus;</button>'
      + '<span class="cpr-zlevel">100%</span>'
      + '<button type="button" class="cpr-zbtn cpr-zin" title="Zoom in">+</button>'
      + '<button type="button" class="cpr-zbtn cpr-zreset" title="Reset zoom">&#8634;</button>'
      + '<span class="cpr-zhint">scroll to zoom &middot; drag to pan</span></div>';
    el.innerHTML = zoombar
      + '<div class="cpr-pagewrap"><div class="cpr-pageinner"><img alt="source document page" src="data:'
      + esc(doc.pageMediaType || "image/png") + ";base64," + esc(doc.pageImageBase64) + '"/>' + boxes + "</div></div>";

    var pagewrap = el.querySelector(".cpr-pagewrap");
    var pageinner = el.querySelector(".cpr-pageinner");
    var img = pageinner.querySelector("img");
    var zp = attachZoomPan({
      wrap: pagewrap, inner: pageinner, img: img,
      levelEl: el.querySelector(".cpr-zlevel"),
      zin: el.querySelector(".cpr-zin"), zout: el.querySelector(".cpr-zout"), zreset: el.querySelector(".cpr-zreset"),
      min: 1, max: 6
    });
    // Zoom to the cited value's box once the image is laid out.
    var hot = null;
    for (var i = 0; i < results.length; i += 1) {
      if (results[i].box && hotValue != null && String(results[i].value) === String(hotValue)) { hot = results[i].box; break; }
    }
    if (hot) {
      var focus = function () { zp.focusBox(hot, 2.2); };
      if (img.complete && img.naturalWidth) { setTimeout(focus, 0); } else { img.addEventListener("load", focus); }
    }
    return el;
  }

  return { esc: esc, renderDoc: renderDoc, attachZoomPan: attachZoomPan, renderZoomablePage: renderZoomablePage };
})();
