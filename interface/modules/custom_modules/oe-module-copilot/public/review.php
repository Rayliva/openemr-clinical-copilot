<?php

/**
 * Clinical Co-Pilot — document review surface (Week 2).
 *
 * Served on the OpenEMR origin (inherits the login session). For the selected owned patient it
 * mints an ownership-checked token, asks the sidecar agent to detect + extract that patient's
 * pending source documents (`POST /documents/pending`), and renders each extraction as the page
 * image with the OCR-located bounding boxes overlaid, beside the extracted values + confidence.
 * Read-only review — the physician-confirm write path is a later slice; nothing is committed here.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    Raych
 * @copyright Copyright (c) 2026 Raych
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

require_once(__DIR__ . "/../../../../globals.php");

use OpenEMR\Common\Acl\AclMain;
use OpenEMR\Common\Csrf\CsrfUtils;
use OpenEMR\Common\Session\SessionWrapperFactory;
use OpenEMR\Core\OEGlobalsBag;
use OpenEMR\Modules\Copilot\Service\PanelService;

if (!AclMain::aclCheckCore('patients', 'demo')) {
    http_response_code(403);
    echo 'Not authorized to use the Clinical Co-Pilot.';
    exit;
}

$session = SessionWrapperFactory::getInstance()->getActiveSession();
$userIdValue = $session->get('authUserID');
$userId = is_numeric($userIdValue) ? (int) $userIdValue : 0;
$csrfToken = CsrfUtils::collectCsrfToken(session: $session);

$patients = (new PanelService())->ownedPatients($userId);
$requestedPid = (int) (filter_input(INPUT_GET, 'pid', FILTER_VALIDATE_INT) ?: 0);
// Optional deep-link to revisit ONE document's review (e.g. a saved "edit this document" link).
$requestedDocumentIdRaw = filter_input(INPUT_GET, 'documentId');
$requestedDocumentId = is_string($requestedDocumentIdRaw) ? $requestedDocumentIdRaw : '';

$agentBase = (string) (getenv('COPILOT_AGENT_URL') ?: 'http://localhost:3040');
$moduleBase = strval(OEGlobalsBag::getInstance()->getWebRoot())
    . '/interface/modules/custom_modules/oe-module-copilot';
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title><?php echo xlt('Co-Pilot — Document Review'); ?></title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; margin: 0; background: #f8f9fa; color: #212529; }
  header { padding: 12px 16px; background: #fff; border-bottom: 1px solid #dee2e6; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  header b { color: #0d6efd; font-size: 15px; }
  header .sub { color: #6c757d; font-size: 12px; }
  select, button { font: inherit; border-radius: 6px; border: 1px solid #ced4da; background: #fff; color: #212529; padding: 7px 10px; }
  button { background: #0d6efd; border-color: #0d6efd; color: #fff; cursor: pointer; }
  button:hover { background: #0b5ed7; border-color: #0b5ed7; }
  button:disabled { opacity: .5; cursor: default; }
  .wrap { padding: 16px; max-width: 1200px; margin: 0 auto; }
  .status { color: #6c757d; padding: 16px 0; }
  .doc { background: #fff; border: 1px solid #dee2e6; border-radius: 8px; margin: 0 0 18px; overflow: hidden; }
  .doc h2 { font-size: 15px; margin: 0; padding: 10px 14px; border-bottom: 1px solid #dee2e6; display: flex; gap: 10px; align-items: center; color: #0d6efd; }
  .doc h2 .pill { font-size: 11px; padding: 2px 8px; border-radius: 20px; }
  .pill.ok { background: #d1e7dd; color: #0f5132; }
  .pill.degraded { background: #fff3cd; color: #664d03; }
  .grid { display: grid; grid-template-columns: minmax(320px, 1fr) minmax(300px, 1fr); gap: 0; }
  @media (max-width: 800px) { .grid { grid-template-columns: 1fr; } }
  .pagewrap { position: relative; background: #f8f9fa; padding: 10px; overflow: auto; max-height: 78vh; border-right: 1px solid #dee2e6; }
  .pageinner { position: relative; display: inline-block; }
  .pageinner img { display: block; max-width: 100%; height: auto; border: 1px solid #dee2e6; }
  .box { position: absolute; border: 2px solid rgba(13,110,253,.55); background: rgba(13,110,253,.10); border-radius: 2px; pointer-events: none; transition: border-color .1s, background .1s; }
  .box.on { border-color: #fd7e14; background: rgba(253,126,20,.22); }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid #dee2e6; font-size: 13px; vertical-align: top; }
  th { color: #0d6efd; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: .4px; }
  tr.row { cursor: default; }
  tr.row:hover { background: #f1f6ff; }
  .val { font-weight: 600; color: #212529; }
  .flag { font-size: 11px; padding: 1px 7px; border-radius: 20px; }
  .flag.high, .flag.critical, .flag.abnormal, .flag.low { background: #f8d7da; color: #842029; }
  .flag.normal { background: #d1e7dd; color: #0f5132; }
  .flag.unknown { background: #e2e3e5; color: #41464b; }
  .match { font-size: 11px; color: #6c757d; }
  .match.unverified { color: #997404; }
  .match.approximate { color: #997404; }
  .conf { font-variant-numeric: tabular-nums; color: #495057; }
  .issues { padding: 14px; color: #842029; }
  .issues li { margin: 4px 0; }
  .note { padding: 8px 14px; color: #6c757d; font-size: 12px; border-top: 1px solid #dee2e6; }
</style>
</head>
<body>
<header>
  <b><?php echo xlt('Co-Pilot Document Review'); ?></b>
  <span class="sub"><?php echo xlt('Extracted values with source bounding boxes — read-only review'); ?></span>
  <span style="flex:1"></span>
  <label class="sub" for="pat"><?php echo xlt('Patient'); ?></label>
  <select id="pat">
    <?php foreach ($patients as $p) {
        $pid = (int) ($p['pid'] ?? 0);
        $label = trim((string) ($p['name'] ?? ''));
        $sel = ($pid === $requestedPid) ? ' selected' : '';
        echo '<option value="' . attr((string) $pid) . '"' . $sel . '>'
            . text(($label !== '' ? $label : 'patient') . ' (pid ' . $pid . ')') . '</option>';
    } ?>
  </select>
  <button id="load"><?php echo xlt('Detect & extract'); ?></button>
</header>

<div class="wrap">
  <div id="status" class="status"><?php echo xlt('Pick a patient and select "Detect & extract".'); ?></div>
  <div id="docs"></div>
</div>

<script src="<?php echo attr($moduleBase); ?>/public/review-render.js"></script>
<script>
(function () {
  "use strict";
  var AGENT_BASE = <?php echo json_encode($agentBase); ?>;
  var MODULE_BASE = <?php echo json_encode($moduleBase); ?>;
  var CSRF = <?php echo json_encode($csrfToken); ?>;
  var DOCUMENT_ID = <?php echo json_encode($requestedDocumentId); ?>;

  var patSel = document.getElementById('pat');
  var loadBtn = document.getElementById('load');
  var statusEl = document.getElementById('status');
  var docsEl = document.getElementById('docs');

  // Attribute-safe HTML escape (escapes quotes too, unlike textContent→innerHTML) — every
  // extracted value flows through this before landing in innerHTML, incl. class/attribute contexts.
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Mint an ownership-checked token for the pid (the server enforces ownership; a pid the
  // logged-in provider does not own is refused, so the client cannot widen scope).
  function mint(pid) {
    var body = new URLSearchParams({ pid: String(pid), csrf_token_form: CSRF });
    return fetch(MODULE_BASE + '/public/session-token.php', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body
    }).then(function (r) {
      if (!r.ok) { throw new Error('mint failed (' + r.status + ')'); }
      return r.json();
    }).then(function (j) { return j.token; });
  }

  function fetchDocuments(pid) {
    return mint(pid).then(function (token) {
      return fetch(AGENT_BASE + '/documents/pending', {
        method: 'POST',
        headers: { 'authorization': 'Bearer ' + token, 'content-type': 'application/json' },
        body: '{}'
      });
    }).then(function (r) {
      if (!r.ok) { throw new Error('extraction failed (' + r.status + ')'); }
      return r.json();
    });
  }

  // Saved per-value dispositions for a document (committed/dismissed) — shown on reopen.
  function decisionsFor(documentId) {
    return fetch(MODULE_BASE + '/public/review-decisions.php?documentId=' + encodeURIComponent(documentId), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : { decisions: {} }; })
      .then(function (j) { return (j && j.decisions) || {}; })
      .catch(function () { return {}; });
  }

  function boxStyle(b) {
    // Boxes are [0,1]-normalized to the page, so percentage positioning needs no pixel dims.
    return 'left:' + (b.x * 100) + '%;top:' + (b.y * 100) + '%;width:' + (b.w * 100) + '%;height:' + (b.h * 100) + '%';
  }

  function renderDoc(doc) {
    var el = document.createElement('div');
    el.className = 'doc';
    var pill = doc.status === 'ok' ? '<span class="pill ok">extracted</span>' : '<span class="pill degraded">needs review</span>';
    var when = doc.date ? ' · ' + esc(doc.date) : '';
    var head = '<h2>' + esc(doc.title || 'Document') + pill + '<span class="sub" style="color:#8b93a7">' + when + '</span></h2>';

    if (doc.status !== 'ok') {
      var issues = (doc.issues || []).map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('');
      el.innerHTML = head + '<div class="issues"><div>Could not extract a valid result set — flagged for manual review:</div><ul>' + issues + '</ul></div>';
      return el;
    }

    var results = doc.results || [];
    var boxes = results.map(function (r, i) {
      return r.box ? '<div class="box" data-i="' + i + '" style="' + boxStyle(r.box) + '"></div>' : '';
    }).join('');
    var img = doc.pageImageBase64
      ? '<div class="pageinner"><img alt="document page" src="data:' + esc(doc.pageMediaType || 'image/png') + ';base64,' + esc(doc.pageImageBase64) + '"/>' + boxes + '</div>'
      : '<div class="status">No page image.</div>';

    var rows = results.map(function (r, i) {
      var flag = esc(r.abnormalFlag || 'unknown');
      var match = esc(r.matchState || '');
      var conf = (typeof r.confidence === 'number') ? (Math.round(r.confidence * 100) + '%') : '';
      var box = r.box ? '' : ' · <span class="match unverified">no box — verify</span>';
      return '<tr class="row" data-i="' + i + '">'
        + '<td>' + esc(r.testName) + '</td>'
        + '<td><span class="val">' + esc(r.value) + '</span> ' + esc(r.unit || '') + '</td>'
        + '<td><span class="flag ' + flag + '">' + flag + '</span></td>'
        + '<td class="conf">' + conf + '</td>'
        + '<td><span class="match ' + match + '">' + match + '</span>' + box + '</td>'
        + '</tr>';
    }).join('');

    el.innerHTML = head
      + '<div class="grid"><div class="pagewrap">' + img + '</div>'
      + '<div><table><thead><tr><th>Test</th><th>Value</th><th>Flag</th><th>Conf.</th><th>Source</th></tr></thead><tbody>'
      + rows + '</tbody></table>'
      + '<div class="note">Boxes show where each value was located on the page. Hover a row to highlight its box. Nothing is written to the chart — this is review only.</div></div></div>';

    // Row ↔ box hover linking.
    var boxEls = el.querySelectorAll('.box');
    el.querySelectorAll('tr.row').forEach(function (tr) {
      tr.addEventListener('mouseenter', function () {
        var i = tr.getAttribute('data-i');
        boxEls.forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-i') === i); });
      });
      tr.addEventListener('mouseleave', function () {
        boxEls.forEach(function (b) { b.classList.remove('on'); });
      });
    });
    return el;
  }

  function load() {
    var pid = parseInt(patSel.value, 10);
    if (!(pid > 0)) { return; }
    loadBtn.disabled = true;
    docsEl.innerHTML = '';
    statusEl.textContent = 'Detecting and extracting documents… (the vision model runs once per document, ~20s each)';
    fetchDocuments(pid).then(function (j) {
      var docs = (j && j.documents) || [];
      if (DOCUMENT_ID) { docs = docs.filter(function (d) { return d.documentId === DOCUMENT_ID; }); }
      if (!docs.length) {
        statusEl.textContent = 'No pending documents for this patient.';
      } else {
        statusEl.textContent = docs.length + ' document(s) extracted.';
        Promise.all(docs.map(function (d) { return decisionsFor(d.documentId); })).then(function (decisionsList) {
          docs.forEach(function (d, idx) {
            var commit = { moduleBase: MODULE_BASE, csrf: CSRF, decisions: decisionsList[idx] || {} };
            docsEl.appendChild(window.CopilotReview.renderDoc(d, commit));
          });
        });
      }
    }).catch(function (e) {
      statusEl.textContent = 'Could not extract documents: ' + e.message;
    }).finally(function () { loadBtn.disabled = false; });
  }

  loadBtn.addEventListener('click', load);
  // Deep-link (a saved "review this document" link): auto-open the selected patient's review.
  if (DOCUMENT_ID && patSel.value) { load(); }
})();
</script>
</body>
</html>
