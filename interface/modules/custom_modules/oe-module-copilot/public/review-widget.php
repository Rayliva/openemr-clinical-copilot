<?php

/**
 * In-chart "Review Documents" launcher + modal (Week 2). Echoed into the OpenEMR top shell beside
 * the chat widget (Bootstrap::renderFloatingWidget). Binds to the currently-open patient, polls the
 * agent's cheap `GET /documents/status` to show a notification dot when the patient has un-reviewed
 * source documents, and on click opens a roomy modal that renders each extraction (page image +
 * OCR bounding boxes + values table) via the shared review renderer. Read-only — nothing is written.
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
    return;
}
$agentBase = strval($agentBase);
$moduleBase = strval($moduleBase);
$csrfToken = strval($csrfToken);
?>
<style>
  /* Light theme matching the OpenEMR (Bootstrap 4) shell: white surfaces, #212529 text, blue accents. */
  /* Circular launcher, stacked above the lab-trends + agent buttons (bottom-right column). */
  #cpr-launch {
    position: fixed; inset-inline-end: 20px; bottom: 146px; z-index: 1050;
    display: none; align-items: center; justify-content: center;
    width: 52px; height: 52px; border: none; border-radius: 50%; cursor: pointer;
    background: #0d6efd; color: #fff; font-size: 22px;
    box-shadow: 0 4px 14px rgba(0,0,0,.20);
  }
  #cpr-launch:hover { background: #0b5ed7; }
  /* Muted, persistent "revisit" state once every document has been reviewed (no notification dot). */
  #cpr-launch.cpr-reviewed { background: #6c757d; box-shadow: 0 2px 8px rgba(0,0,0,.15); }
  #cpr-launch.cpr-reviewed:hover { background: #5c636a; }
  #cpr-launch.cpr-reviewed .cpr-dot { display: none; }
  #cpr-label { display: none; }  /* circular button has no room for a text label */
  #cpr-launch .cpr-dot {
    position: absolute; top: -2px; inset-inline-end: -2px;
    min-width: 18px; height: 18px; padding: 0 4px; border-radius: 9px;
    background: #dc3545; color: #fff; font-weight: 700; font-size: 11px; border: 2px solid #fff;
    display: inline-flex; align-items: center; justify-content: center;
  }
  #cpr-modal {
    position: fixed; inset: 0; z-index: 1100; display: none;
    align-items: center; justify-content: center; background: rgba(33,37,41,.5);
  }
  #cpr-modal.open { display: flex; }
  #cpr-modal-panel {
    width: 92%; max-width: 1100px; max-height: 88vh; display: flex; flex-direction: column;
    background: #fff; color: #212529; border: 1px solid #dee2e6; border-radius: 8px;
    box-shadow: 0 18px 50px rgba(0,0,0,.25); overflow: hidden;
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  }
  #cpr-modal-head { padding: 12px 16px; background: #f8f9fa; border-bottom: 1px solid #dee2e6; display: flex; align-items: center; gap: 10px; }
  #cpr-modal-head b { color: #0d6efd; }
  #cpr-modal-head .sub { color: #6c757d; font-size: 12px; }
  #cpr-modal-x { margin-inline-start: auto; border: none; background: none; color: #6c757d; font-size: 20px; cursor: pointer; }
  #cpr-modal-body { padding: 16px; overflow: auto; }
  #cpr-modal-status { color: #6c757d; padding: 8px 0; }
  #cpr-spin { display: inline-block; width: 14px; height: 14px; margin-inline-end: 8px; border: 2px solid #dee2e6; border-top-color: #0d6efd; border-radius: 50%; animation: cprspin 0.8s linear infinite; vertical-align: middle; }
  @keyframes cprspin { to { transform: rotate(360deg); } }
  #cpr-reviewed { margin-top: 14px; }
  .cpr-revwrap > summary { cursor: pointer; color: #0d6efd; font-weight: 600; font-size: 13px; padding: 6px 0; }
  .cpr-revlist { border: 1px solid #dee2e6; border-radius: 6px; margin-top: 6px; }
  .cpr-revitem { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-bottom: 1px solid #f1f3f5; font-size: 13px; }
  .cpr-revitem:last-child { border-bottom: none; }
  .cpr-revname { flex: 1; color: #212529; }
  .cpr-revdate { color: #6c757d; font-variant-numeric: tabular-nums; }
  .cpr-revbtn { border: 1px solid #0d6efd; background: #fff; color: #0d6efd; border-radius: 5px; padding: 3px 10px; font-size: 12px; cursor: pointer; }
  .cpr-revbtn:hover { background: #f1f6ff; }
</style>

<button id="cpr-launch" type="button" title="Review uploaded documents">
  &#128196; <span id="cpr-label">Review Documents</span> <span class="cpr-dot" id="cpr-count">0</span>
</button>

<div id="cpr-modal" role="dialog" aria-modal="true" aria-label="Document review">
  <div id="cpr-modal-panel">
    <div id="cpr-modal-head">
      <b>Document Review</b>
      <span class="sub" id="cpr-modal-ctx"></span>
      <button id="cpr-modal-x" type="button" aria-label="Close">&times;</button>
    </div>
    <div id="cpr-modal-body">
      <div id="cpr-modal-status">No documents loaded.</div>
      <div id="cpr-modal-docs"></div>
      <div id="cpr-reviewed"></div>
    </div>
  </div>
</div>

<script src="<?php echo attr($moduleBase); ?>/public/review-render.js"></script>
<script>
(function () {
  "use strict";
  var AGENT_BASE = <?php echo json_encode($agentBase); ?>;
  var MODULE_BASE = <?php echo json_encode($moduleBase); ?>;
  var CSRF = <?php echo json_encode($csrfToken); ?>;

  var launch = document.getElementById('cpr-launch');
  var countEl = document.getElementById('cpr-count');
  var labelEl = document.getElementById('cpr-label');
  var modal = document.getElementById('cpr-modal');
  var modalCtx = document.getElementById('cpr-modal-ctx');
  var modalStatus = document.getElementById('cpr-modal-status');
  var modalDocs = document.getElementById('cpr-modal-docs');
  var reviewedEl = document.getElementById('cpr-reviewed');

  var lastPid = 0;
  var token = null, tokenPid = 0;

  // The currently-open patient from the top shell's Knockout view model (guard every hop).
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

  // A CSRF token for the CURRENT session (the page token goes stale if OpenEMR rotated the session
  // id since load, which fails the mint's CSRF check). Falls back to the page token on any failure.
  function freshCsrf() {
    return fetch(MODULE_BASE + '/public/csrf.php', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json().catch(function () { return null; }) : null; })
      .then(function (ct) { return (ct && ct.csrf) || CSRF; })
      .catch(function () { return CSRF; });
  }

  // Ownership-checked mint for the bound pid (the server refuses a pid the provider doesn't own).
  function mint(pid) {
    if (token && tokenPid === pid) { return Promise.resolve(token); }
    return freshCsrf().then(function (csrf) {
      var body = new URLSearchParams({ pid: String(pid), csrf_token_form: csrf });
      return fetch(MODULE_BASE + '/public/session-token.php', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body
      }).then(function (r) {
        if (!r.ok) { throw new Error('mint failed (' + r.status + ')'); }
        return r.json();
      }).then(function (j) { token = j.token; tokenPid = pid; return token; });
    });
  }

  // Call the agent with the pid-bound token. Tokens are short-lived (5-min TTL — the minter
  // re-mints on expiry by design rather than refreshing), so if one expires while the physician
  // sits on the chart, the next call 401s. On a 401 we invalidate the cached token, re-mint once,
  // and retry transparently — otherwise "Review Documents" fails after ~5 minutes on a chart.
  function agent(path, opts) {
    function attempt(forceFresh) {
      if (forceFresh) { token = null; tokenPid = 0; }
      return mint(lastPid).then(function (t) {
        var o = Object.assign({}, opts || {});
        o.headers = Object.assign({}, (opts && opts.headers) || {}, { 'authorization': 'Bearer ' + t });
        return fetch(AGENT_BASE + path, o).then(function (r) {
          if (r.status === 401 && !forceFresh) { return attempt(true); }
          return r;
        });
      });
    }
    return attempt(false);
  }

  // The documents this provider has already fully reviewed (module endpoint, session-auth) — the
  // launcher subtracts these from the agent's detected documents so it retires once all are handled.
  function reviewState(pid) {
    return fetch(MODULE_BASE + '/public/review-state.php?pid=' + encodeURIComponent(pid), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (j) { return { ids: (j && j.reviewedDocumentIds) || [], docs: (j && j.reviewedDocuments) || [] }; })
      .catch(function () { return { ids: [], docs: [] }; });
  }

  // Show the launcher only for documents that are detected AND not yet fully reviewed.
  function refreshStatus() {
    if (!(lastPid > 0)) { launch.style.display = 'none'; return; }
    var pid = lastPid;
    Promise.all([
      agent('/documents/status', { method: 'GET' }).then(function (r) { return r.ok ? r.json() : { total: 0 }; }),
      reviewState(pid)
    ]).then(function (res) {
      if (pid !== lastPid) { return; } // patient switched mid-flight — drop this result
      var s = res[0] || { total: 0 };
      var reviewed = (res[1] && res[1].ids) || [];
      var detected = s.documentIds || [];
      // Precise id-matching when the agent returns detected ids; else fall back to count math.
      var count = detected.length
        ? detected.filter(function (id) { return reviewed.indexOf(id) === -1; }).length
        : Math.max(0, (s.total || 0) - reviewed.length);
      var hasDocs = detected.length > 0 || (s.total || 0) > 0;
      if (count > 0) {
        // Un-reviewed documents → prominent notification with a count.
        countEl.textContent = String(count);
        if (labelEl) { labelEl.textContent = 'Review Documents'; }
        launch.classList.remove('cpr-reviewed');
        launch.title = 'Review uploaded documents';
        launch.style.display = 'inline-flex';
      } else if (hasDocs) {
        // Everything reviewed → a muted, persistent entry to revisit the review (no dot).
        if (labelEl) { labelEl.textContent = 'Reviewed Documents'; }
        launch.classList.add('cpr-reviewed');
        launch.title = 'Revisit document review (all reviewed)';
        launch.style.display = 'inline-flex';
      } else {
        launch.style.display = 'none';
      }
    }).catch(function () { launch.style.display = 'none'; });
  }

  var modalOpen = false;

  // Each document's saved per-value dispositions (accepted/discarded), so reopening shows
  // committed/dismissed state rather than a blank slate.
  function decisionsFor(documentId) {
    return fetch(MODULE_BASE + '/public/review-decisions.php?documentId=' + encodeURIComponent(documentId), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : { decisions: {} }; })
      .then(function (j) { return (j && j.decisions) || {}; })
      .catch(function () { return {}; });
  }

  function renderDocs(docs) {
    modalDocs.innerHTML = '';
    // Fetch every document's dispositions first, then render in order so the modal reflects prior review.
    Promise.all(docs.map(function (d) { return decisionsFor(d.documentId); })).then(function (decisionsList) {
      docs.forEach(function (d, idx) {
        var commit = { moduleBase: MODULE_BASE, csrf: CSRF, decisions: decisionsList[idx] || {} };
        modalDocs.appendChild(window.CopilotReview.renderDoc(d, commit));
      });
    });
  }

  // The "Reviewed documents" list (names + dates, NO extraction) with a Revisit action each — so 100
  // handled documents don't all load, but any is still reachable + editable.
  function renderReviewedList(docs) {
    if (!docs || !docs.length) { reviewedEl.innerHTML = ''; return; }
    var esc = window.CopilotReview.esc;
    var items = docs.map(function (d) {
      return '<div class="cpr-revitem"><span class="cpr-revname">' + esc(d.name || 'Document') + '</span>'
        + '<span class="cpr-revdate">' + esc(d.date || '') + '</span>'
        + '<button type="button" class="cpr-revbtn" data-id="' + esc(d.documentId) + '">Revisit</button></div>';
    }).join('');
    reviewedEl.innerHTML = '<details class="cpr-revwrap"><summary>Reviewed documents (' + docs.length + ')</summary>'
      + '<div class="cpr-revlist">' + items + '</div></details>';
    reviewedEl.querySelectorAll('.cpr-revbtn').forEach(function (b) {
      b.addEventListener('click', function () { revisitDoc(b.getAttribute('data-id')); });
    });
  }

  // Revisit ONE reviewed document: extract just it (VLM-free — the extraction is persisted) and render.
  function revisitDoc(documentId) {
    modalStatus.innerHTML = '<span id="cpr-spin"></span>Loading document…';
    agent('/documents/pending', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ documentIds: [documentId] }) })
      .then(function (r) { if (!r.ok) { throw new Error('load failed (' + r.status + ')'); } return r.json(); })
      .then(function (j) {
        if (!modalOpen) { return; }
        var docs = (j && j.documents) || [];
        renderDocs(docs);
        modalStatus.textContent = docs.length ? 'Revisiting 1 reviewed document (edits re-commit):' : 'Could not load that document.';
      }).catch(function (e) { modalStatus.textContent = 'Could not load: ' + e.message; });
  }

  // Load ONLY the un-reviewed documents (so a 100-document patient doesn't extract all 100) + show the
  // reviewed list for revisiting. Polls while un-reviewed docs are still extracting elsewhere.
  function loadModal(attempt) {
    if (!modalOpen) { return; }
    Promise.all([
      agent('/documents/status', { method: 'GET' }).then(function (r) { return r.ok ? r.json() : { total: 0, documentIds: [] }; }),
      reviewState(lastPid)
    ]).then(function (res) {
      if (!modalOpen) { return; }
      var status = res[0] || {};
      var state = res[1] || { ids: [], docs: [] };
      var detected = status.documentIds || [];
      var reviewed = state.ids || [];
      var unreviewed = detected.filter(function (id) { return reviewed.indexOf(id) === -1; });

      renderReviewedList(state.docs);

      if (unreviewed.length === 0) {
        modalDocs.innerHTML = '';
        modalStatus.textContent = (state.docs && state.docs.length)
          ? 'All documents reviewed — revisit any below.'
          : 'No documents pending review for this patient.';
        return;
      }
      agent('/documents/pending', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ documentIds: unreviewed }) })
        .then(function (r) { if (!r.ok) { throw new Error('extract failed (' + r.status + ')'); } return r.json(); })
        .then(function (j) {
          if (!modalOpen) { return; }
          var docs = (j && j.documents) || [];
          renderDocs(docs);
          var stillExtracting = docs.length < unreviewed.length;
          if (stillExtracting && attempt < 30) {
            modalStatus.innerHTML = '<span id="cpr-spin"></span>' + docs.length + ' of ' + unreviewed.length + ' ready — extracting…';
            setTimeout(function () { loadModal(attempt + 1); }, 3000);
          } else {
            modalStatus.textContent = docs.length + ' document(s) to review:';
          }
        }).catch(function (e) { modalStatus.textContent = 'Could not load documents: ' + e.message; });
    }).catch(function (e) { modalStatus.textContent = 'Could not load documents: ' + e.message; });
  }

  function openModal() {
    var p = currentPatient();
    modalCtx.textContent = p ? (p.name || ('pid ' + p.pid)) : '';
    modal.classList.add('open');
    modalOpen = true;
    modalDocs.innerHTML = '';
    reviewedEl.innerHTML = '';
    modalStatus.innerHTML = '<span id="cpr-spin"></span>Loading documents…';
    loadModal(0);
  }

  // Re-evaluate the launcher on close: if the physician just reviewed everything, it should retire.
  function closeModal() { modal.classList.remove('open'); modalOpen = false; refreshStatus(); }

  launch.addEventListener('click', openModal);
  document.getElementById('cpr-modal-x').addEventListener('click', closeModal);
  modal.addEventListener('click', function (e) { if (e.target === modal) { closeModal(); } });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeModal(); } });

  // Watch for the open patient changing (a new chart) → full refresh. ALSO re-poll the SAME patient
  // on a gentle cadence (~16s) so a document that appears while you're already sitting on the chart
  // shows up WITHOUT having to switch patients and back — the previous behaviour only refreshed on a
  // pid change, so a fresh upload never updated the dot until you navigated away. The /documents/status
  // detect is agent-cached (~10s TTL), so this cadence is cheap and does not hammer the FHIR endpoint.
  var sameCounter = 0;
  setInterval(function () {
    var p = currentPatient();
    var pid = p ? p.pid : 0;
    if (pid !== lastPid) {
      lastPid = pid;
      token = null; tokenPid = 0;
      closeModal();
      sameCounter = 0;
      refreshStatus();
      return;
    }
    if (pid > 0 && ++sameCounter >= 8) { // 8 × 2s ≈ 16s
      sameCounter = 0;
      refreshStatus();
    }
  }, 2000);

  // Snappy: re-check the moment the physician returns to the tab / window — e.g. right after uploading
  // a document in OpenEMR's Documents view — so the dot updates immediately instead of after the poll.
  function repollIfActive() { if (lastPid > 0) { sameCounter = 0; refreshStatus(); } }
  window.addEventListener('focus', repollIfActive);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { repollIfActive(); } });
})();
</script>
