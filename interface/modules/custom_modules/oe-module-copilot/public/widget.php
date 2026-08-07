<?php

/**
 * Floating, patient-scoped Clinical Co-Pilot widget — echoed into the OpenEMR top shell
 * by Bootstrap::renderFloatingWidget (event `main.body.render.post`). Docks bottom-right,
 * binds to the currently-open patient (no switcher), mints an ownership-checked token per
 * pid, and chats with the sidecar agent over the verification-gated /chat SSE endpoint.
 *
 * Expects in scope (set by the caller): $agentBase, $moduleBase, $csrfToken.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    Raych
 * @copyright Copyright (c) 2026 Raych
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

if (!isset($agentBase, $moduleBase, $csrfToken)) {
    return; // never render half-configured
}
?>
<style>
  #copilot-widget, #copilot-widget * { box-sizing: border-box; }
  #copilot-launcher {
    position: fixed; inset-inline-end: 20px; bottom: 18px; z-index: 1050;
    width: 52px; height: 52px; border-radius: 50%; border: none; cursor: pointer;
    background: #2f6fed; color: #fff; font-size: 22px; box-shadow: 0 4px 14px rgba(0,0,0,.28);
  }
  #copilot-launcher:hover { background: #2a63d4; }
  #copilot-panel {
    position: fixed; inset-inline-end: 20px; bottom: 82px; z-index: 1060;
    width: 380px; max-width: calc(100vw - 40px); height: 560px; max-height: calc(100vh - 120px);
    display: none; flex-direction: column; background: #fff; color: #1a1d24;
    border: 1px solid #d6dae2; border-radius: 12px; box-shadow: 0 10px 34px rgba(0,0,0,.30);
    font: 14px/1.5 system-ui, sans-serif; overflow: hidden;
  }
  #copilot-panel.open { display: flex; }
  #copilot-head { padding: 10px 14px; background: #f4f6fa; border-bottom: 1px solid #e2e6ee; display: flex; align-items: center; gap: 8px; }
  #copilot-head b { color: #2f6fed; }
  #copilot-head .sub { font-size: 12px; color: #6b7280; margin-inline-start: auto; }
  #copilot-x { border: none; background: none; cursor: pointer; font-size: 18px; color: #6b7280; }
  #copilot-log { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
  .copilot-msg { padding: 8px 11px; border-radius: 10px; max-width: 88%; white-space: pre-wrap; word-wrap: break-word; }
  .copilot-msg.user { align-self: flex-end; background: #2f6fed; color: #fff; }
  .copilot-msg.bot { align-self: flex-start; background: #eef1f6; color: #1a1d24; }
  /* Safety warnings: always visible, pinned above the answer, deliberately loud. */
  .copilot-warnbanner { margin-bottom: 8px; padding: 8px 10px; border-radius: 8px; background: #fdecea; border: 1px solid #f0b7b1; border-inline-start: 3px solid #b3261e; }
  .copilot-warnline { font-size: 12.5px; color: #8a1c14; font-weight: 600; }
  .copilot-warnline + .copilot-warnline { margin-top: 4px; }
  /* Answer body: grouped bullet lists (plain text, no bold). */
  .copilot-answer .copilot-list { margin: 3px 0 6px; padding-inline-start: 18px; }
  .copilot-answer .copilot-list li { margin: 1px 0; }
  /* Info notes: demoted to a click-to-expand disclosure, out of the way of the answer. */
  .copilot-info { margin-top: 8px; font-size: 12px; }
  .copilot-info > summary { cursor: pointer; color: #4b5563; list-style: none; user-select: none; }
  .copilot-info > summary::-webkit-details-marker { display: none; }
  .copilot-info[open] > summary { margin-bottom: 4px; }
  .copilot-infoline { color: #4b5563; padding: 3px 0 3px 8px; border-inline-start: 2px solid #d6dae2; margin-top: 3px; }
  .copilot-sources { margin-top: 8px; font-size: 12px; }
  .copilot-sources > summary { cursor: pointer; color: #1f7a4d; list-style: none; user-select: none; }
  .copilot-sources > summary::-webkit-details-marker { display: none; }
  .copilot-sources[open] > summary { margin-bottom: 4px; }
  .copilot-source { padding: 4px 0 4px 8px; border-inline-start: 2px solid #a7d3ba; margin-top: 4px; }
  .copilot-source-label { color: #1f7a4d; font-weight: 600; }
  .copilot-source-text { color: #374151; margin-top: 2px; white-space: pre-wrap; }
  .copilot-docpage { position: relative; max-width: 100%; margin-top: 4px; }
  .copilot-docpage img { width: 100%; display: block; border: 1px solid #d6dae2; border-radius: 6px; }
  .copilot-box { position: absolute; border: 1px solid rgba(31,122,77,.5); background: rgba(31,122,77,.08); border-radius: 2px; pointer-events: none; }
  .copilot-box.hot { border: 2px solid #d9822b; background: rgba(217,130,43,.18); box-shadow: 0 0 0 2px rgba(217,130,43,.25); }
  #copilot-suggest { padding: 0 12px 8px; display: flex; flex-wrap: wrap; gap: 6px; }
  .copilot-suggest-chip { font-size: 12.5px; padding: 5px 10px; border-radius: 999px; border: 1px solid #cdd5e2; background: #f7f9fc; color: #2f4a7a; cursor: pointer; }
  .copilot-suggest-chip:hover { background: #eef3fb; }
  #copilot-form { display: flex; gap: 6px; padding: 10px 12px; border-top: 1px solid #e2e6ee; }
  #copilot-q { flex: 1; border: 1px solid #cdd5e2; border-radius: 8px; padding: 8px 10px; font: inherit; }
  #copilot-send { border: none; background: #2f6fed; color: #fff; border-radius: 8px; padding: 0 14px; cursor: pointer; }
  #copilot-send:disabled { opacity: .5; cursor: default; }
  .copilot-empty { color: #6b7280; font-size: 13px; padding: 10px 4px; }
  .copilot-typing i { display:inline-block; width:6px; height:6px; margin:0 2px; border-radius:50%; background:#9aa3b7; animation: copilot-blink 1.2s infinite both; }
  .copilot-typing i:nth-child(2){ animation-delay:.2s } .copilot-typing i:nth-child(3){ animation-delay:.4s }
  @keyframes copilot-blink { 0%,80%,100%{opacity:.2} 40%{opacity:1} }
  /* Lab trends: a stacked circular launcher (above the agent button) → a large modal. */
  #copilot-trends-launcher {
    position: fixed; inset-inline-end: 20px; bottom: 82px; z-index: 1050;
    width: 52px; height: 52px; border-radius: 50%; border: none; cursor: pointer;
    background: #1f7a4d; color: #fff; font-size: 22px; box-shadow: 0 4px 14px rgba(0,0,0,.28);
  }
  #copilot-trends-launcher:hover { background: #1a6a42; }
  #copilot-trends-modal { position: fixed; inset: 0; z-index: 1100; display: none; align-items: center; justify-content: center; background: rgba(26,29,36,.5); }
  #copilot-trends-modal.open { display: flex; }
  #copilot-trends-panel {
    width: 94%; max-width: 880px; height: 90vh; max-height: 90vh; display: flex; flex-direction: column;
    background: #fff; color: #1a1d24; border: 1px solid #d6dae2; border-radius: 10px;
    box-shadow: 0 18px 50px rgba(0,0,0,.30); overflow: hidden; font: 14px/1.5 system-ui, sans-serif;
  }
  #copilot-trends-head { padding: 12px 16px; background: #f4f6fa; border-bottom: 1px solid #e2e6ee; display: flex; align-items: center; gap: 10px; }
  #copilot-trends-head b { color: #1f7a4d; }
  #copilot-trends-head .sub { color: #6b7280; font-size: 12px; }
  #copilot-trends-x { margin-inline-start: auto; border: none; background: none; color: #6b7280; font-size: 20px; cursor: pointer; }
  #copilot-trends-body { padding: 16px; overflow: auto; display: flex; flex-direction: column; gap: 12px; }
  .copilot-trend-chips { display:flex; flex-wrap:wrap; gap:6px; }
  .copilot-trend-chip { font-size:13px; padding:5px 12px; border-radius:999px; border:1px solid #cdd5e2; background:#f7f9fc; color:#2f4a7a; cursor:pointer; }
  .copilot-trend-chip.on { background:#2f6fed; color:#fff; border-color:#2f6fed; }
  .copilot-trend-caption { font-size:13px; color:#4b5563; }
  .copilot-trend-note { font-size:12px; color:#8a6d1c; background:#fef7e6; border:1px solid #f0dca8; border-radius:6px; padding:5px 8px; }
  .copilot-trend-empty { color:#6b7280; font-size:13px; padding:10px 4px; }
  /* Chart on the left, its clicked-point source document on the right (stacks on a narrow modal). */
  .copilot-trend-split { display:flex; flex-wrap:wrap; gap:16px; align-items:flex-start; }
  .copilot-trend-left { flex:1 1 320px; min-width:250px; max-width:430px; display:flex; flex-direction:column; gap:8px; }
  .copilot-trend-right { flex:2 1 320px; min-width:250px; }
  .copilot-trend-src-hint { color:#8a94a6; font-size:12.5px; padding:8px 2px; }
  .copilot-chart svg { width:100%; height:auto; display:block; }
  .copilot-chart .copx-axis { stroke:#c9cfdb; stroke-width:1; }
  .copilot-chart .copx-line { fill:none; stroke:#2f6fed; stroke-width:2; }
  .copilot-chart .copx-band { fill:rgba(31,122,77,.10); }
  .copilot-chart .copx-bandline { stroke:rgba(31,122,77,.55); stroke-width:1; stroke-dasharray:3 3; }
  .copilot-trend-refnote { font-size:12px; color:#374151; background:#eef7f1; border:1px solid #cfe6d8; border-radius:6px; padding:5px 8px; }
  .copilot-trend-refnote b { color:#1f7a4d; }
  .copilot-trend-refsrc { color:#6b7280; }
  .copilot-ref-src-link, .copilot-ref-quote a { color:#1f7a4d; text-decoration:underline; }
  .copilot-ref-detail summary { cursor:pointer; color:#1f7a4d; font-size:11px; margin-top:4px; list-style:none; }
  .copilot-ref-detail summary::-webkit-details-marker { display:none; }
  .copilot-ref-detail summary::before { content:'📖 '; }
  .copilot-ref-quote { margin-top:5px; font-size:12px; color:#374151; background:#fff; border:1px solid #e2e6ee; border-radius:5px; padding:6px 8px; }
  .copilot-ref-quote mark { background:#fff3b0; padding:0 2px; border-radius:2px; }
  .copilot-chart .copx-pt { fill:#2f6fed; cursor:pointer; }
  .copilot-chart .copx-pt:hover { fill:#d9822b; }
  .copilot-chart .copx-lbl { fill:#6b7280; font-size:11px; }
  /* Source-document image → click to open fullscreen lightbox. */
  .copilot-docpage { cursor: zoom-in; }
  #copilot-lightbox { position: fixed; inset: 0; z-index: 1200; display: none; background: rgba(0,0,0,.88); }
  #copilot-lightbox.open { display: block; }
  #copilot-lightbox .copilot-lb-viewport { position: absolute; inset: 0; overflow: auto; padding: 24px; box-sizing: border-box; }
  #copilot-lightbox .copilot-lb-viewport.cpr-zoomable { cursor: grab; }
  #copilot-lightbox .copilot-lb-viewport.cpr-grabbing { cursor: grabbing; user-select: none; }
  #copilot-lightbox .copilot-docpage { position: relative; width: -moz-fit-content; width: fit-content; max-width: none; margin: 0 auto; cursor: inherit; }
  #copilot-lightbox img { display: block; border-radius: 4px; }
  #copilot-lightbox .copilot-lb-hint { position: fixed; left: 0; right: 0; bottom: 12px; text-align: center; color: #cfd6e0; font-size: 12px; pointer-events: none; }
  #copilot-lightbox-x { position: fixed; top: 14px; inset-inline-end: 18px; font-size: 30px; color: #fff; background: none; border: none; cursor: pointer; z-index: 1201; line-height: 1; }
</style>

<button id="copilot-launcher" type="button" style="display:none" title="<?php echo xla('Clinical Co-Pilot'); ?>" aria-label="<?php echo xla('Clinical Co-Pilot'); ?>">✦</button>
<div id="copilot-widget">
  <div id="copilot-panel" role="dialog" aria-label="<?php echo xla('Clinical Co-Pilot'); ?>">
    <div id="copilot-head">
      <b>✦ <?php echo xlt('Co-Pilot'); ?></b>
      <span class="sub" id="copilot-ctx"></span>
      <button id="copilot-x" type="button" aria-label="<?php echo xla('Close'); ?>">×</button>
    </div>
    <div id="copilot-log"></div>
    <div id="copilot-suggest"></div>
    <form id="copilot-form" autocomplete="off">
      <input id="copilot-q" type="text" placeholder="<?php echo xla('Ask about this patient…'); ?>" />
      <button id="copilot-send" type="submit"><?php echo xlt('Send'); ?></button>
    </form>
  </div>
</div>

<button id="copilot-trends-launcher" type="button" style="display:none" title="<?php echo xla('Lab trends'); ?>" aria-label="<?php echo xla('Lab trends'); ?>">📈</button>
<div id="copilot-trends-modal" role="dialog" aria-modal="true" aria-label="<?php echo xla('Lab trends'); ?>">
  <div id="copilot-trends-panel">
    <div id="copilot-trends-head">
      <b>📈 <?php echo xlt('Lab trends'); ?></b>
      <span class="sub" id="copilot-trends-ctx"></span>
      <button id="copilot-trends-x" type="button" aria-label="<?php echo xla('Close'); ?>">×</button>
    </div>
    <div id="copilot-trends-body"></div>
  </div>
</div>
<div id="copilot-lightbox" role="dialog" aria-modal="true" aria-label="<?php echo xla('Source document'); ?>">
  <button id="copilot-lightbox-x" type="button" aria-label="<?php echo xla('Close'); ?>">×</button>
  <div class="copilot-lb-hint"><?php echo xlt('Scroll to zoom · drag to pan · double-click to zoom · Esc to close'); ?></div>
  <div class="copilot-lb-hint"><?php echo xlt('Click the page to zoom in · click outside or press Esc to close'); ?></div>
</div>

<script>
(function () {
  if (window.__copilotWidgetLoaded) { return; }
  window.__copilotWidgetLoaded = true;

  var AGENT_BASE = <?php echo js_escape($agentBase); ?>;
  var MODULE_BASE = <?php echo js_escape($moduleBase); ?>;
  var CSRF = <?php echo js_escape($csrfToken); ?>;

  // Curated, UC-mapped suggestions (static — no model generation, no new safety surface).
  var SUGGESTIONS = [
    'Patient summary',
    'What are the active medications?',
    'Any documented allergies or contraindications?',
    'What should I confirm before renewing her meds?'
  ];

  var launcher = document.getElementById('copilot-launcher');
  var panel = document.getElementById('copilot-panel');
  var closeBtn = document.getElementById('copilot-x');
  var log = document.getElementById('copilot-log');
  var suggest = document.getElementById('copilot-suggest');
  var form = document.getElementById('copilot-form');
  var qEl = document.getElementById('copilot-q');
  var sendBtn = document.getElementById('copilot-send');
  var ctxEl = document.getElementById('copilot-ctx');
  var trendsLauncher = document.getElementById('copilot-trends-launcher');
  var trendsModal = document.getElementById('copilot-trends-modal');
  var trendsBody = document.getElementById('copilot-trends-body');
  var trendsCtx = document.getElementById('copilot-trends-ctx');
  var lightbox = document.getElementById('copilot-lightbox');

  var token = null, boundPid = null, messages = [], busy = false;

  // The currently-open patient ({pid, name}) from the top shell's Knockout view model,
  // or null when no chart is open (guard every hop — the VM may not exist yet).
  function currentPatient() {
    try {
      var vm = window.top && window.top.app_view_model;
      var data = vm && vm.application_data;
      var pat = data && typeof data.patient === 'function' ? data.patient() : null;
      var pid = pat && typeof pat.pid === 'function' ? parseInt(pat.pid(), 10) : 0;
      if (!(pid > 0)) { return null; }
      var name = pat && typeof pat.pname === 'function' ? (pat.pname() || '') : '';
      return { pid: pid, name: name };
    } catch (e) { return null; }
  }

  function bubble(role) {
    var d = document.createElement('div');
    d.className = 'copilot-msg ' + role;
    log.appendChild(d); log.scrollTop = log.scrollHeight;
    return d;
  }
  function typingEl() {
    var s = document.createElement('span');
    s.className = 'copilot-typing'; s.innerHTML = '<i></i><i></i><i></i>';
    return s;
  }
  // Strip the appended deterministic sections from the streamed body so the bubble shows
  // the answer; the flags render as chips via the done event.
  function bodyOf(text) {
    var cut = text.length;
    ['\n\nSafety flags:', '\n\nNote:', '\n\nCould not verify'].forEach(function (m) {
      var i = text.indexOf(m); if (i >= 0 && i < cut) { cut = i; }
    });
    return text.slice(0, cut).trim();
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  // Minimal, safe markup: "- " bullets and blank-line paragraph breaks (no bold — this is a
  // plain conversational tone). Text is HTML-escaped FIRST so model output can never inject
  // markup at the DOM boundary.
  function renderMarkdown(text) {
    var esc = escapeHtml(text);
    return esc.split(/\n{2,}/).map(function (block) {
      var html = '', bullets = [];
      function flush() { if (bullets.length) { html += '<ul class="copilot-list">' + bullets.join('') + '</ul>'; bullets = []; } }
      block.split('\n').forEach(function (line) {
        var m = /^-\s+(.*)$/.exec(line);
        if (m) { bullets.push('<li>' + m[1] + '</li>'); }
        else if (line.trim() !== '') { flush(); html += '<div>' + line + '</div>'; }
      });
      flush();
      return html;
    }).join('');
  }

  // Final render: safety warnings pinned ABOVE the answer (always visible), the answer body
  // as grouped/bulleted markdown, then a small verdict badge, then info notes demoted into a
  // click-to-expand disclosure. Prominence tracks finding severity (see response-formatting spec).
  // Slice B (w2-inline-source-viewer): resolve a chart citation to its source document and render the
  // page screenshot with the cited value's bounding box, in-chat. resolveSource (module endpoint,
  // session-cookie auth) maps an observation uuid → the DocumentReference it was derivedFrom;
  // /documents/pending (agent token) returns the page image + per-value boxes. Read-only; the box is
  // re-derived on demand, never persisted.
  function boxStyle(b) {
    return 'left:' + (b.x * 100) + '%;top:' + (b.y * 100) + '%;width:' + (b.w * 100) + '%;height:' + (b.h * 100) + '%';
  }
  // Resolve a chart citation's Observation → its source document. A genuine "no source" is
  // {found:false}; a FAILED request (session/500/network) returns {error:true} so the caller can
  // distinguish "entered directly (no source)" from "couldn't load" (absence ≠ failure).
  function resolveSource(ref) {
    return fetch(MODULE_BASE + '/public/source-document.php?observation=' + encodeURIComponent(ref), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json().catch(function () { return { error: true }; }) : { error: true }; })
      .catch(function () { return { error: true }; });
  }
  var sourceDraftsPromise = null;
  function fetchSourceDrafts() {
    // One /documents/pending fetch per answer, cached — reuses the widget's pid-bound agent token.
    if (sourceDraftsPromise) { return sourceDraftsPromise; }
    sourceDraftsPromise = fetch(AGENT_BASE + '/documents/pending', {
      method: 'POST', headers: { 'authorization': 'Bearer ' + token, 'content-type': 'application/json' }, body: '{}'
    }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    return sourceDraftsPromise;
  }
  function renderDocOverlay(doc, value) {
    if (!doc.pageImageBase64) { return '<div class="copilot-source-text">No page image for this document.</div>'; }
    var boxes = (doc.results || []).map(function (r) {
      if (!r.box) { return ''; }
      var hot = (String(r.value) === String(value)) ? ' hot' : '';
      return '<div class="copilot-box' + hot + '" style="' + boxStyle(r.box) + '"></div>';
    }).join('');
    return '<div class="copilot-docpage"><img alt="source document page" src="data:'
      + escapeHtml(doc.pageMediaType || 'image/png') + ';base64,' + escapeHtml(doc.pageImageBase64) + '"/>' + boxes + '</div>';
  }
  // Open a source-document page FULLSCREEN (lightbox) with the SAME pan/zoom as the document
  // reviewer: scroll to zoom toward the cursor, drag to pan, double-click to zoom a step; it opens
  // focused on the cited value's box. A click on the page never closes — only the dark backdrop / ×
  // / Esc close it. Pan/zoom is the shared CopilotReview.attachZoomPan (one implementation); a coarse
  // click-to-step-zoom is the fallback if that helper isn't on the page.
  var lbZoom = 1;
  function fitLbImage(img) {
    var fitW = Math.min(window.innerWidth * 0.94, (window.innerHeight * 0.90) * img.naturalWidth / img.naturalHeight);
    img.style.maxWidth = 'none'; img.style.maxHeight = 'none'; img.style.height = 'auto';
    return Math.round(fitW);
  }
  function hotBoxFor(doc, value) {
    var rs = (doc && doc.results) || [];
    for (var i = 0; i < rs.length; i++) { if (rs[i].box && String(rs[i].value) === String(value)) { return rs[i].box; } }
    return null;
  }
  function removeLbViewport() {
    var v = lightbox.querySelector('.copilot-lb-viewport');
    if (v) { lightbox.removeChild(v); }
  }
  function openLightbox(doc, value) {
    lbZoom = 1;
    // Fresh viewport each open (attached as a sibling of × / hint). Recreating it means the pan/zoom
    // listeners are garbage-collected with it on close — no accumulation across opens on a reused node.
    removeLbViewport();
    var viewport = document.createElement('div');
    viewport.className = 'copilot-lb-viewport';
    viewport.innerHTML = renderDocOverlay(doc, value);
    lightbox.appendChild(viewport);
    lightbox.classList.add('open');
    var img = viewport.querySelector('img');
    var page = viewport.querySelector('.copilot-docpage');
    if (!img || !page) { return; }
    var zp = null;
    // A click on the PAGE never closes (pan/zoom instead). A click on the dark viewport backdrop
    // closes — unless it ended a pan-drag (movedLast) so panning-into-the-edge doesn't dismiss it.
    page.addEventListener('click', function (e) { e.stopPropagation(); });
    viewport.addEventListener('click', function (e) {
      if (e.target === viewport && !(zp && zp.movedLast && zp.movedLast())) { closeLightbox(); }
    });
    function init() {
      img.style.width = fitLbImage(img) + 'px'; // zoom 1 = fit-to-screen
      zp = (window.CopilotReview && CopilotReview.attachZoomPan)
        ? CopilotReview.attachZoomPan({ wrap: viewport, inner: page, img: img, min: 1, max: 8 })
        : null;
      if (zp) {
        page.addEventListener('dblclick', function (e) { zp.apply(zp.getZoom() * 1.5, { x: e.clientX, y: e.clientY }); });
        var hot = hotBoxFor(doc, value);
        if (hot) { setTimeout(function () { zp.focusBox(hot, 2.4); }, 0); }
      } else {
        // Fallback: no shared helper on the page → coarse click-to-step zoom.
        page.addEventListener('click', function () {
          lbZoom = lbZoom >= 3 ? 1 : lbZoom + 0.75;
          img.style.width = Math.round(fitLbImage(img) * lbZoom) + 'px';
        });
      }
    }
    if (img.complete && img.naturalWidth) { init(); } else { img.addEventListener('load', init); }
  }
  function closeLightbox() {
    lightbox.classList.remove('open');
    removeLbViewport(); lbZoom = 1;
  }
  // Render a source-doc overlay into a container. Primary path: the shared IN-PLACE zoomable page
  // viewer (scroll-to-zoom, drag-to-pan, zoom toolbar) — the SAME behavior as the review page, so
  // the physician zooms/pans the PDF where it sits (no fullscreen needed). It opens focused on the
  // cited value's box. Fallback (helper unavailable): the static overlay with click-to-fullscreen.
  function attachDocOverlay(container, doc, value) {
    if (window.CopilotReview && CopilotReview.renderZoomablePage) {
      container.innerHTML = '';
      container.appendChild(CopilotReview.renderZoomablePage(doc, value));
      return;
    }
    container.innerHTML = renderDocOverlay(doc, value);
    var page = container.querySelector('.copilot-docpage');
    if (page) { page.addEventListener('click', function () { openLightbox(doc, value); }); }
  }
  function appendSourceDoc(bot, documentFhirId, value) {
    var det = document.createElement('details'); det.className = 'copilot-sources';
    var sum = document.createElement('summary'); sum.textContent = '📄 View source document';
    det.appendChild(sum);
    var slot = document.createElement('div'); slot.className = 'copilot-source'; slot.textContent = 'Loading source…';
    det.appendChild(slot);
    var loaded = false;
    det.addEventListener('toggle', function () {
      if (!det.open || loaded) { return; }
      loaded = true;
      fetchSourceDrafts().then(function (data) {
        var docs = (data && data.documents) || [];
        var doc = null;
        for (var i = 0; i < docs.length; i++) { if (docs[i].documentId === documentFhirId) { doc = docs[i]; break; } }
        if (doc) { attachDocOverlay(slot, doc, value); } else { slot.innerHTML = '<div class="copilot-source-text">Source document not available.</div>'; }
      });
    });
    bot.appendChild(det);
  }

  // ---- Lab trends (read-only chart of extracted lab Observations over time) -------------------
  function fmtNum(n) { return (Math.round(n * 100) / 100).toString(); }
  function escapeReg(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  // Highlight the referenced range inside a source quote (the "referenced area"): wrap the "low to
  // high" span (e.g. "13 to 150") in <mark>, else the individual bound numbers. Input is escaped first.
  function highlightRange(quote, rr) {
    var out = escapeHtml(quote);
    var lo = fmtNum(rr.low), hi = fmtNum(rr.high);
    var span = new RegExp('(' + escapeReg(lo) + '\\s*(?:to|–|-|and)\\s*' + escapeReg(hi) + ')');
    if (span.test(out)) { return out.replace(span, '<mark>$1</mark>'); }
    out = out.replace(new RegExp('(^|[^\\d.])(' + escapeReg(hi) + ')(?![\\d.])'), '$1<mark>$2</mark>');
    out = out.replace(new RegExp('(^|[^\\d.])(' + escapeReg(lo) + ')(?![\\d.])'), '$1<mark>$2</mark>');
    return out;
  }

  // Fetch the bound patient's per-test lab series from the token-bound agent endpoint. Resilient to
  // transient failures (a stale mint CSRF, a momentary OpenEMR-FHIR 502 under load): one full retry
  // with a FRESH token before giving up. Returns the LabSeriesResult JSON, or null (empty state).
  function fetchSeries() {
    var p = currentPatient();
    if (p === null) { return Promise.resolve(null); }
    function go(t) {
      return fetch(AGENT_BASE + '/labs/series', {
        method: 'POST', headers: { 'authorization': 'Bearer ' + t, 'content-type': 'application/json' }, body: '{}'
      });
    }
    function attempt(force) {
      return mint(p.pid, force)
        .then(go)
        .then(function (r) {
          // A 401 (expired token) re-mints once within the attempt; any other non-ok rejects so the
          // outer retry can try again with a fresh token.
          if (r.status === 401) {
            return mint(p.pid, true).then(go).then(function (r2) {
              if (!r2.ok) { throw new Error('HTTP ' + r2.status); }
              return r2.json();
            });
          }
          if (!r.ok) { throw new Error('HTTP ' + r.status); }
          return r.json();
        });
    }
    return attempt(false).catch(function () {
      return attempt(true).catch(function () { return null; });
    });
  }

  // Pure: build an inline SVG line chart for one series (no charting library → self-contained,
  // deterministic). Points are REAL readings only — connected, never interpolated/extrapolated. Each
  // dot carries its Observation uuid for click-to-source. A single-point series renders just the dot.
  function trendSvg(series) {
    var pts = series.points, W = 320, H = 150, padL = 40, padR = 12, padT = 12, padB = 26;
    var iw = W - padL - padR, ih = H - padT - padB;
    var xs = pts.map(function (p) { return Date.parse(p.date); });
    var ys = pts.map(function (p) { return p.value; });
    var xmin = Math.min.apply(null, xs), xmax = Math.max.apply(null, xs);
    var ymin = Math.min.apply(null, ys), ymax = Math.max.apply(null, ys);
    var yr = (ymax - ymin) || Math.abs(ymax) || 1;
    ymin -= yr * 0.15; ymax += yr * 0.15;
    var xspan = (xmax - xmin) || 1, yspan = (ymax - ymin) || 1;
    function X(t) { return pts.length === 1 ? padL + iw / 2 : padL + (t - xmin) / xspan * iw; }
    function Y(v) { return padT + ih - (v - ymin) / yspan * ih; }
    var coords = pts.map(function (p, i) { return { x: X(xs[i]), y: Y(p.value), p: p }; });
    var poly = coords.map(function (c) { return c.x.toFixed(1) + ',' + c.y.toFixed(1); }).join(' ');
    var circles = coords.map(function (c) {
      var tip = c.p.rawValue + (series.unit ? ' ' + series.unit : '') + ' · ' + c.p.date.slice(0, 10);
      return '<circle class="copx-pt" data-obsuuid="' + escapeHtml(c.p.obsUuid) + '" cx="' + c.x.toFixed(1) +
        '" cy="' + c.y.toFixed(1) + '" r="4"><title>' + escapeHtml(tip) + '</title></circle>';
    }).join('');
    var line = pts.length > 1 ? '<polyline class="copx-line" points="' + poly + '"/>' : '';
    var yBot = padT + ih;
    // Age/sex reference band (general, cited context — never a patient finding). Drawn behind the
    // line + dots, CLIPPED to the data-driven y-domain so the real trend stays readable even when a
    // value sits outside the normal zone. The numeric range is also stated in the caption note.
    var band = '';
    var rr = series.referenceRange;
    if (rr) {
      var yHi = Y(rr.high), yLo = Y(rr.low);                 // higher value → smaller y
      var top = Math.max(padT, Math.min(yHi, yLo));
      var bot = Math.min(yBot, Math.max(yHi, yLo));
      if (bot > top + 0.5) {
        band = '<rect class="copx-band" x="' + padL + '" y="' + top.toFixed(1) + '" width="' + iw + '" height="' + (bot - top).toFixed(1) + '"/>';
        if (yHi >= padT && yHi <= yBot) { band += '<line class="copx-bandline" x1="' + padL + '" y1="' + yHi.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + yHi.toFixed(1) + '"/>'; }
        if (yLo >= padT && yLo <= yBot) { band += '<line class="copx-bandline" x1="' + padL + '" y1="' + yLo.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + yLo.toFixed(1) + '"/>'; }
      }
    }
    var axes =
      '<line class="copx-axis" x1="' + padL + '" y1="' + padT + '" x2="' + padL + '" y2="' + yBot + '"/>' +
      '<line class="copx-axis" x1="' + padL + '" y1="' + yBot + '" x2="' + (W - padR) + '" y2="' + yBot + '"/>' +
      '<text class="copx-lbl" x="' + (padL - 4) + '" y="' + (padT + 4) + '" text-anchor="end">' + escapeHtml(fmtNum(ymax)) + '</text>' +
      '<text class="copx-lbl" x="' + (padL - 4) + '" y="' + yBot + '" text-anchor="end">' + escapeHtml(fmtNum(ymin)) + '</text>' +
      '<text class="copx-lbl" x="' + padL + '" y="' + (H - 6) + '" text-anchor="start">' + escapeHtml(pts[0].date.slice(0, 10)) + '</text>' +
      (pts.length > 1 ? '<text class="copx-lbl" x="' + (W - padR) + '" y="' + (H - 6) + '" text-anchor="end">' + escapeHtml(pts[pts.length - 1].date.slice(0, 10)) + '</text>' : '');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="lab trend chart">' + band + axes + line + circles + '</svg>';
  }

  function renderTrends(data) {
    trendsBody.innerHTML = '';
    // A failed fetch (null) is NOT a documented absence — never report it as "no labs on file"
    // (provenance-and-grounding: a failed read is not a negative finding).
    if (data === null) {
      trendsBody.innerHTML = '<div class="copilot-trend-empty">Couldn’t reach the lab-trend service — please try again.</div>';
      return;
    }
    if (!data.documented || !data.series || !data.series.length) {
      trendsBody.innerHTML = '<div class="copilot-trend-empty">No lab results are on file for this patient.</div>';
      return;
    }
    var series = data.series;
    var chips = document.createElement('div'); chips.className = 'copilot-trend-chips';
    var body = document.createElement('div');
    trendsBody.appendChild(chips); trendsBody.appendChild(body);

    function select(idx) {
      Array.prototype.forEach.call(chips.children, function (c, i) { c.className = 'copilot-trend-chip' + (i === idx ? ' on' : ''); });
      var s = series[idx];
      body.innerHTML = '';
      // Two columns: chart (left) + its clicked-point source document (right), so the source is
      // visible beside the graph rather than below it.
      var split = document.createElement('div'); split.className = 'copilot-trend-split';
      var left = document.createElement('div'); left.className = 'copilot-trend-left';
      var right = document.createElement('div'); right.className = 'copilot-trend-right';
      split.appendChild(left); split.appendChild(right); body.appendChild(split);

      var cap = document.createElement('div'); cap.className = 'copilot-trend-caption';
      cap.textContent = s.test + (s.unit ? ' (' + s.unit + ')' : '') + ' — ' + s.points.length + ' result' + (s.points.length > 1 ? 's' : '');
      left.appendChild(cap);
      var chart = document.createElement('div'); chart.className = 'copilot-chart';
      chart.innerHTML = trendSvg(s);
      left.appendChild(chart);
      if (s.points.length < 2) {
        var note = document.createElement('div'); note.className = 'copilot-trend-note';
        note.textContent = '1 result on file — no trend yet.';
        left.appendChild(note);
      }
      // Age/sex reference range as a cited caption (general context, not a patient finding). The
      // source is a LINK to the authoritative page, and an expander shows the exact supporting quote
      // with the referenced range highlighted (the general-knowledge analog of the value's box).
      if (s.referenceRange) {
        var rr2 = s.referenceRange;
        var refn = document.createElement('div'); refn.className = 'copilot-trend-refnote';
        var rangeTxt = fmtNum(rr2.low) + '–' + fmtNum(rr2.high) + (rr2.unit ? ' ' + rr2.unit : '');
        // Caption: just "Typical <test> for <population>: <range>". The source (link + the exact
        // quoted sentence) lives ONLY in the expander below — nothing auto-shown but the range.
        refn.innerHTML = 'Typical ' + escapeHtml(s.test) + ' for ' + escapeHtml(rr2.population) + ': <b>'
          + escapeHtml(rangeTxt) + '</b>';
        if (rr2.sourceQuote || rr2.sourceUrl) {
          var det = document.createElement('details'); det.className = 'copilot-ref-detail';
          var sum = document.createElement('summary'); sum.textContent = 'Show source reference';
          det.appendChild(sum);
          var q = document.createElement('div'); q.className = 'copilot-ref-quote';
          var srcLink = rr2.sourceUrl
            ? '<a href="' + escapeHtml(rr2.sourceUrl) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(rr2.source) + ' ↗</a>'
            : escapeHtml(rr2.source);
          q.innerHTML = (rr2.sourceQuote ? '“' + highlightRange(rr2.sourceQuote, rr2) + '” ' : '')
            + '<div class="copilot-trend-refsrc" style="margin-top:3px">Source: ' + srcLink + '</div>'
            + (rr2.note ? '<div class="copilot-trend-refsrc" style="margin-top:3px">' + escapeHtml(rr2.note) + '</div>' : '');
          det.appendChild(q);
          refn.appendChild(det);
        } else if (rr2.note) {
          refn.innerHTML += '<br><span class="copilot-trend-refsrc">' + escapeHtml(rr2.note) + '</span>';
        }
        left.appendChild(refn);
      }
      var srcSlot = document.createElement('div');
      srcSlot.innerHTML = '<div class="copilot-trend-src-hint">Click a point on the chart to view its source document.</div>';
      right.appendChild(srcSlot);
      // Click a point → resolve its Observation to the source document + box (reuses the Slice-B path).
      chart.addEventListener('click', function (e) {
        var t = e.target, uuid = (t && t.getAttribute && t.getAttribute('data-obsuuid')) ||
          (t && t.parentNode && t.parentNode.getAttribute && t.parentNode.getAttribute('data-obsuuid'));
        if (!uuid) { return; }
        srcSlot.innerHTML = '<div class="copilot-source">Loading source…</div>';
        sourceDraftsPromise = null;
        resolveSource(uuid).then(function (res) {
          if (res && res.error) {
            srcSlot.innerHTML = '<div class="copilot-source">Your OpenEMR session may have timed out — reload the page to view source documents. (The chart and trends keep working.)</div>';
            return;
          }
          if (!(res && res.found && res.documentFhirId)) {
            srcSlot.innerHTML = '<div class="copilot-source">This value was entered directly in the chart (no source document).</div>';
            return;
          }
          fetchSourceDrafts().then(function (dd) {
            var docs = (dd && dd.documents) || [], doc = null;
            for (var i = 0; i < docs.length; i++) { if (docs[i].documentId === res.documentFhirId) { doc = docs[i]; break; } }
            if (doc) { attachDocOverlay(srcSlot, doc, res.value); } else { srcSlot.innerHTML = '<div class="copilot-source">Source document not available.</div>'; }
            // Keep the loaded source in view (it sits beside the chart; only nudge if off-screen).
            try { srcSlot.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) {}
          });
        });
      });
    }
    series.forEach(function (s, i) {
      var chip = document.createElement('button'); chip.type = 'button'; chip.className = 'copilot-trend-chip';
      chip.textContent = s.test; chip.addEventListener('click', function () { select(i); });
      chips.appendChild(chip);
    });
    select(0);
  }

  function openTrendsModal() {
    var p = currentPatient();
    if (p === null) { return; }
    trendsCtx.textContent = p.name || ('pid ' + p.pid);
    trendsModal.classList.add('open');
    trendsBody.innerHTML = '<div class="copilot-trend-empty">Loading lab trends…</div>';
    fetchSeries().then(renderTrends);
  }
  function closeTrendsModal() { trendsModal.classList.remove('open'); }

  function renderDone(bot, body, data) {
    bot.innerHTML = '';
    var findings = data.findings || [];
    var warns = findings.filter(function (f) { return f.severity === 'warning'; });
    var infos = findings.filter(function (f) { return f.severity !== 'warning'; });

    if (warns.length) {
      var wb = document.createElement('div'); wb.className = 'copilot-warnbanner';
      warns.forEach(function (f) {
        var w = document.createElement('div'); w.className = 'copilot-warnline';
        w.textContent = '⚠ ' + (f.message || '');
        wb.appendChild(w);
      });
      bot.appendChild(wb);
    }

    var ans = document.createElement('div'); ans.className = 'copilot-answer';
    ans.innerHTML = renderMarkdown(body || "I can't confirm that from the record.");
    bot.appendChild(ans);

    // No verification badge: everything shown has already passed the gate (uncited /
    // ungrounded claims are dropped before display), so a per-message "verified" stamp is
    // redundant and an "unverified" one only plants doubt. The load-bearing signal is the
    // safety warning banner above; that stays.
    if (infos.length) {
      var det = document.createElement('details'); det.className = 'copilot-info';
      var sum = document.createElement('summary');
      sum.textContent = 'ℹ ' + infos.length + ' clinical note' + (infos.length > 1 ? 's' : '');
      det.appendChild(sum);
      infos.forEach(function (f) {
        var d = document.createElement('div'); d.className = 'copilot-infoline';
        d.textContent = f.message || '';
        det.appendChild(d);
      });
      bot.appendChild(det);
    }

    // Inline source viewer (w2-inline-source-viewer, Slice A): guideline-backed claims expand in place
    // — like the clinical notes above — to show the cited passage. Document-derived chart values get a
    // screenshot + bounding box in Slice B; here they carry no expandable passage.
    var citations = data.citations || [];
    var guides = [], seenRef = {};
    citations.forEach(function (c) {
      (c.sources || []).forEach(function (s) {
        if (s && s.kind === 'guideline' && s.ref && !seenRef[s.ref]) { seenRef[s.ref] = 1; guides.push(s); }
      });
    });
    if (guides.length) {
      var sd = document.createElement('details'); sd.className = 'copilot-sources';
      var ss = document.createElement('summary');
      ss.textContent = '📄 ' + guides.length + ' guideline source' + (guides.length > 1 ? 's' : '');
      sd.appendChild(ss);
      guides.forEach(function (s) {
        var wrap = document.createElement('div'); wrap.className = 'copilot-source';
        var lbl = document.createElement('div'); lbl.className = 'copilot-source-label';
        lbl.textContent = (s.doc || 'Guideline') + (s.section ? ' · ' + s.section : '') + (s.page ? ' · p.' + s.page : '');
        var txt = document.createElement('div'); txt.className = 'copilot-source-text';
        txt.textContent = s.text || '';
        wrap.appendChild(lbl); wrap.appendChild(txt);
        sd.appendChild(wrap);
      });
      bot.appendChild(sd);
    }

    // Slice B: a chart citation that traces to an ingested document gets an in-chat "View source
    // document" expander (page screenshot + the cited value's box). Resolution is per source + async;
    // a value entered directly in the chart resolves to no document and adds no expander.
    sourceDraftsPromise = null;
    var chartSeen = {};
    citations.forEach(function (c) {
      (c.sources || []).forEach(function (s) {
        if (!(s && s.kind === 'chart' && s.ref) || chartSeen[s.ref]) { return; }
        chartSeen[s.ref] = 1;
        resolveSource(s.ref).then(function (res) {
          if (res && res.found && res.documentFhirId) { appendSourceDoc(bot, res.documentFhirId, res.value); }
        });
      });
    });

    log.scrollTop = log.scrollHeight;
  }

  // A CSRF token for the CURRENT session: the page token (CSRF) goes stale if OpenEMR rotated the
  // session id since load, which fails the mint's CSRF check (→ chat/trends "couldn't reach"). Fall
  // back to the page token if the refresh fails.
  function freshCsrf() {
    return fetch(MODULE_BASE + '/public/csrf.php', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json().catch(function () { return null; }) : null; })
      .then(function (ct) { return (ct && ct.csrf) || CSRF; })
      .catch(function () { return CSRF; });
  }

  // Mint an ownership-checked token for the given pid (server enforces ownership).
  function mint(pid, force) {
    if (token && !force) { return Promise.resolve(token); }
    return freshCsrf().then(function (csrf) {
      var body = new URLSearchParams({ pid: String(pid), csrf_token_form: csrf });
      return fetch(MODULE_BASE + '/public/session-token.php', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
      }).then(function (r) {
        if (!r.ok) { return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.error || ('HTTP ' + r.status)); }); }
        return r.json();
      }).then(function (j) { token = j.token; return token; });
    });
  }

  function postChat(pid, force) {
    return mint(pid, force).then(function (t) {
      return fetch(AGENT_BASE + '/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + t },
        body: JSON.stringify({ messages: messages })
      });
    });
  }

  async function send(text) {
    if (busy) { return; }
    var p = currentPatient();
    if (p === null) { refreshState(); return; }
    // A new patient => a fresh session (one bound pid per session).
    if (p.pid !== boundPid) { boundPid = p.pid; token = null; messages = []; log.innerHTML = ''; }

    busy = true; sendBtn.disabled = true;
    var um = bubble('user'); um.textContent = text; messages.push({ role: 'user', content: text });
    suggest.innerHTML = '';
    var bot = bubble('bot'); var typing = typingEl(); bot.appendChild(typing);
    try {
      var res = await postChat(p.pid, false);
      if (res.status === 401) { res = await postChat(p.pid, true); } // expired -> re-mint once
      if (!res.ok) { if (typing.parentNode) { typing.remove(); } bot.textContent = 'Error: HTTP ' + res.status; return; }
      var reader = res.body.getReader(), dec = new TextDecoder();
      var buf = '', answer = '', doneData = null;
      while (true) {
        var chunk = await reader.read(); if (chunk.done) { break; }
        buf += dec.decode(chunk.value, { stream: true });
        var parts = buf.split('\n\n'); buf = parts.pop();
        for (var i = 0; i < parts.length; i++) {
          var line = parts[i].split('\n').find(function (l) { return l.indexOf('data: ') === 0; });
          if (!line) { continue; }
          var data = JSON.parse(line.slice(6));
          if (data.delta) { if (typing.parentNode) { typing.remove(); } answer += data.delta; bot.textContent = bodyOf(answer); log.scrollTop = log.scrollHeight; }
          else if ('verdictOk' in data) { doneData = data; }
        }
      }
      if (typing.parentNode) { typing.remove(); }
      renderDone(bot, bodyOf(answer), doneData || { verdictOk: false, findings: [], ungrounded: [] });
      messages.push({ role: 'assistant', content: answer });
    } catch (err) {
      if (typing.parentNode) { typing.remove(); }
      bot.textContent = 'Error: ' + err.message;
    } finally {
      busy = false; sendBtn.disabled = false; qEl.focus();
    }
  }

  // Reflect the current patient context: show the patient name, enable the chat +
  // suggestions, or prompt to open a chart. Called on open and whenever the patient
  // changes. Switching patients starts a fresh conversation (clears the old messages).
  function refreshState() {
    var p = currentPatient();
    if (p === null) {
      boundPid = null; token = null; messages = [];
      ctxEl.textContent = '';
      suggest.innerHTML = '';
      log.innerHTML = '<div class="copilot-empty">' + 'Open a patient chart to use the Co-Pilot.' + '</div>';
      qEl.disabled = true; sendBtn.disabled = true;
      return;
    }
    qEl.disabled = false; sendBtn.disabled = false;
    ctxEl.textContent = p.name || ('pid ' + p.pid);
    // A different patient than the current conversation => start fresh: clear the old
    // messages, drop the token, and show the suggestions again.
    if (p.pid !== boundPid) {
      boundPid = p.pid; token = null; messages = [];
      log.innerHTML = '';
      closeTrendsModal();
      renderSuggestions();
    }
  }

  function renderSuggestions() {
    suggest.innerHTML = '';
    SUGGESTIONS.forEach(function (s) {
      var c = document.createElement('button');
      c.type = 'button'; c.className = 'copilot-suggest-chip'; c.textContent = s;
      c.addEventListener('click', function () { send(s); });
      suggest.appendChild(c);
    });
  }

  function openPanel() { panel.classList.add('open'); refreshState(); qEl.focus(); }
  function closePanel() { panel.classList.remove('open'); }

  // The Co-Pilot is a patient-scoped tool: show the launcher ONLY when a chart is open,
  // and hide it (closing the panel) on any page with no patient in context — so there is
  // no "open a chart first" dead end.
  function syncLauncher() {
    if (currentPatient() === null) {
      launcher.style.display = 'none';
      trendsLauncher.style.display = 'none';
      if (panel.classList.contains('open')) { closePanel(); }
      if (trendsModal.classList.contains('open')) { closeTrendsModal(); }
    } else {
      launcher.style.display = '';
      trendsLauncher.style.display = '';
    }
  }

  launcher.addEventListener('click', function () { panel.classList.contains('open') ? closePanel() : openPanel(); });
  closeBtn.addEventListener('click', closePanel);
  trendsLauncher.addEventListener('click', openTrendsModal);
  document.getElementById('copilot-trends-x').addEventListener('click', closeTrendsModal);
  trendsModal.addEventListener('click', function (e) { if (e.target === trendsModal) { closeTrendsModal(); } });
  // Backdrop-close is handled per-viewport inside openLightbox (with a pan-drag guard); the × button
  // and Esc also close. (No blanket lightbox click handler — a pan-drag ending on the edge must not dismiss.)
  document.getElementById('copilot-lightbox-x').addEventListener('click', closeLightbox);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeLightbox(); closeTrendsModal(); } });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var q = qEl.value.trim(); if (!q) { return; }
    qEl.value = ''; send(q);
  });

  // Re-bind live as the physician navigates (Knockout observable): toggle the launcher's
  // visibility with patient context, and if the panel is open, refreshState() updates the
  // name and clears the previous patient's chat.
  try {
    var appVm = window.top && window.top.app_view_model;
    var patObs = appVm && appVm.application_data && appVm.application_data.patient;
    if (patObs && typeof patObs.subscribe === 'function') {
      patObs.subscribe(function () { syncLauncher(); if (panel.classList.contains('open')) { refreshState(); } });
    }
  } catch (e) { /* observable not available; the initial sync below still applies */ }

  // Initial visibility for the page the widget loaded on (e.g. injected while already in a chart).
  syncLauncher();
})();
</script>
<?php
// end floating co-pilot widget
