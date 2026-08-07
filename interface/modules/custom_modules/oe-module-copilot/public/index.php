<?php

/**
 * Clinical Co-Pilot embedded chat UI. Served on the OpenEMR origin (inherits the
 * login session); the patient switcher lists only patients the logged-in provider
 * owns, and each chat is bound to a token minted for the selected pid.
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

// Enforce the same ACL the menu entry declares (Bootstrap.php acl_req). The menu link
// only governs visibility; a user navigating here directly must still pass the ACL,
// not rely solely on the providerID ownership gate below.
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

// Where the sidecar agent's /chat lives. Local dev default; prod injects the public
// subdomain. Must share the browser page's scheme (no https->http mixed content).
$agentBase = (string) (getenv('COPILOT_AGENT_URL') ?: 'http://localhost:3032');
$moduleBase = OEGlobalsBag::getInstance()->getWebRoot()
    . '/interface/modules/custom_modules/oe-module-copilot';
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title><?php echo xlt('Clinical Co-Pilot'); ?></title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0; background: #0f1115; color: #e6e6e6; }
  header { padding: 12px 16px; background: #161922; border-bottom: 1px solid #2a2f3a; }
  header b { color: #7db4ff; }
  .wrap { max-width: 820px; margin: 0 auto; padding: 16px; }
  .row { display: flex; gap: 8px; margin-bottom: 12px; align-items: center; }
  label.lbl { font-size: 13px; color: #8b93a7; }
  select, input, textarea, button { font: inherit; border-radius: 8px; border: 1px solid #2a2f3a; background: #1b1f2a; color: #e6e6e6; padding: 8px 10px; }
  #log { min-height: 300px; }
  .msg { padding: 10px 12px; border-radius: 10px; margin: 8px 0; white-space: pre-wrap; }
  .user { background: #21324a; }
  .bot { background: #1b1f2a; border: 1px solid #2a2f3a; }
  .meta { font-size: 12px; color: #8b93a7; margin-top: 4px; }
  .warn { color: #ffcf7d; }
  form { display: flex; gap: 8px; }
  #q { flex: 1; }
  button { background: #2a5bd7; border-color: #2a5bd7; cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
  .empty { color: #8b93a7; padding: 24px 0; }
  .typing i { display:inline-block; width:6px; height:6px; margin:0 2px; border-radius:50%; background:#8b93a7; animation: blink 1.2s infinite both; }
  .typing i:nth-child(2){ animation-delay:.2s } .typing i:nth-child(3){ animation-delay:.4s }
  @keyframes blink { 0%,80%,100%{ opacity:.2 } 40%{ opacity:1 } }
  /* Bottom icon bar: annotations collapse into click-to-expand pills (see w2-answer-icon-bar spec). */
  .copx-bar { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; }
  .copx-icon { display:inline-flex; align-items:center; gap:5px; font-size:12px; padding:4px 10px; border-radius:999px;
    cursor:pointer; border:1px solid #2a2f3a; background:#20242e; color:#9aa3b7; }
  .copx-icon .n { font-weight:700; }
  .copx-icon.warn { background:#3a2317; border-color:#8a3b1e; color:#ffb37d; }   /* loud — a warning is never hidden */
  .copx-icon.src { background:#16261d; border-color:#1f5b3d; color:#7fd1a7; }
  .copx-icon[aria-expanded="true"] { outline:2px solid #2a5bd7; outline-offset:1px; }
  .copx-panel { display:none; margin-top:7px; padding:8px 10px; border-radius:8px; background:#161922; border:1px solid #2a2f3a; font-size:12.5px; }
  .copx-panel.open { display:block; }
  .copx-line { padding:3px 0 3px 9px; border-inline-start:2px solid #2a2f3a; margin-top:5px; color:#c9cfdb; }
  .copx-line:first-child { margin-top:0; }
  .copx-line.warn { border-inline-start-color:#b3261e; color:#ffb37d; font-weight:600; }
  .copx-src-label { color:#7fd1a7; font-weight:600; }
  .copx-src-text { color:#c9cfdb; margin-top:2px; white-space:pre-wrap; }
</style>
</head>
<body>
<header><b><?php echo xlt('Clinical Co-Pilot'); ?></b> — <?php echo xlt('read-only, cited'); ?></header>
<div class="wrap">
  <?php if (count($patients) === 0) { ?>
    <p class="empty">
        <?php echo xlt('No patients are on your panel (patient_data.providerID). Log in as a provider who owns patients to use the Co-Pilot.'); ?>
    </p>
  <?php } else { ?>
  <div class="row">
    <label class="lbl" for="pid"><?php echo xlt('Patient'); ?>:</label>
    <select id="pid" style="flex:1">
      <?php foreach ($patients as $p) { ?>
        <option value="<?php echo attr((string) $p['pid']); ?>"><?php echo text($p['name'] . ' (pid ' . $p['pid'] . ')'); ?></option>
      <?php } ?>
    </select>
  </div>
  <div id="log"></div>
  <form id="f">
    <input id="q" placeholder="<?php echo xla('Ask about this patient…'); ?>" autocomplete="off" />
    <button id="send" type="submit"><?php echo xlt('Send'); ?></button>
  </form>
  <?php } ?>
</div>
<script>
  const AGENT_BASE = <?php echo js_escape($agentBase); ?>;
  const MODULE_BASE = <?php echo js_escape($moduleBase); ?>;
  const CSRF = <?php echo js_escape($csrfToken); ?>;

  const log = document.getElementById('log');
  const pidEl = document.getElementById('pid');
  let messages = [];
  let token = null;

  function bubble(role) {
    const d = document.createElement('div');
    d.className = 'msg ' + (role === 'user' ? 'user' : 'bot');
    log.appendChild(d); log.scrollTop = log.scrollHeight;
    return d;
  }
  function typingEl() {
    const s = document.createElement('span'); s.className = 'typing';
    s.innerHTML = '<i></i><i></i><i></i>'; return s;
  }
  // The answer body is everything before the appended deterministic sections; those
  // render as click-to-expand icons instead of raw text.
  function bodyOf(text) {
    let cut = text.length;
    for (const m of ['\n\nSafety flags:', '\n\nNote:', '\n\nCould not verify']) {
      const i = text.indexOf(m); if (i >= 0 && i < cut) cut = i;
    }
    return text.slice(0, cut).trim();
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function uniqReasons(arr) {
    return Array.from(new Set(arr.map(function (x) { return x.reason; }))).join('; ');
  }
  // Collapse every deterministic annotation into a bottom icon bar: ⚠ warnings, ℹ notes
  // (info findings + unverified + critic-withheld), 📄 guideline sources. Each pill toggles a
  // shared panel; a warning auto-opens so a contraindication is never hidden (w2-answer-icon-bar).
  function renderDone(bot, body, data) {
    bot.innerHTML = '';
    const ans = document.createElement('div');
    ans.textContent = body || "I can only answer from this patient's chart, and I don't have that here.";
    bot.appendChild(ans);

    const findings = data.findings || [];
    const warns = findings.filter(function (f) { return f.severity === 'warning'; });
    const infos = findings.filter(function (f) { return f.severity !== 'warning'; });

    // Notes = info findings + the unverified-omitted note + the critic-withheld note (count + reason
    // only; never the withheld/dropped statement text — that is the content the gate rejected).
    const noteLines = infos.map(function (f) { return { text: f.message || '' }; });
    if ((data.ungrounded || []).length) {
      noteLines.push({ text: data.ungrounded.length + ' statement(s) omitted as unverified (' + uniqReasons(data.ungrounded) + ')' });
    }
    if ((data.withheld || []).length) {
      const w = data.withheld.map(function (x) {
        return x.reason === 'uncited' ? 'no citation' : 'recommended a treatment action';
      });
      noteLines.push({ text: data.withheld.length + ' statement(s) withheld by the safety critic (' +
        Array.from(new Set(w)).join('; ') + ') — surfaces & flags, does not recommend treatment or doses' });
    }

    // Guideline sources (deduped by ref). Chart-row citations resolve to documents only in the
    // in-chart widget (Slice B); here we surface the guideline passages.
    const guides = [], seen = {};
    (data.citations || []).forEach(function (c) {
      (c.sources || []).forEach(function (s) {
        if (s && s.kind === 'guideline' && s.ref && !seen[s.ref]) { seen[s.ref] = 1; guides.push(s); }
      });
    });

    if (!warns.length && !noteLines.length && !guides.length) { log.scrollTop = log.scrollHeight; return; }

    const bar = document.createElement('div'); bar.className = 'copx-bar';
    const panel = document.createElement('div'); panel.className = 'copx-panel';
    let active = null;

    function pill(kind, icon, count, build) {
      if (!count) { return; }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'copx-icon' + (kind === 'warn' ? ' warn' : kind === 'src' ? ' src' : '');
      b.setAttribute('aria-expanded', 'false');
      b.innerHTML = icon + ' <span class="n">' + count + '</span>';
      function open() {
        Array.prototype.forEach.call(bar.children, function (x) { x.setAttribute('aria-expanded', 'false'); });
        b.setAttribute('aria-expanded', 'true');
        panel.innerHTML = ''; build(panel); panel.className = 'copx-panel open'; active = kind;
        log.scrollTop = log.scrollHeight;
      }
      b.addEventListener('click', function () {
        if (active === kind) { panel.className = 'copx-panel'; active = null; b.setAttribute('aria-expanded', 'false'); return; }
        open();
      });
      b.__open = open;
      bar.appendChild(b);
    }

    function lines(items) {
      return function (into) {
        items.forEach(function (it) {
          const d = document.createElement('div');
          d.className = 'copx-line' + (it.warn ? ' warn' : '');
          d.textContent = it.text;
          into.appendChild(d);
        });
      };
    }
    function sources(items) {
      return function (into) {
        items.forEach(function (s) {
          const wrap = document.createElement('div'); wrap.className = 'copx-line';
          const lbl = document.createElement('div'); lbl.className = 'copx-src-label';
          lbl.textContent = (s.doc || 'Guideline') + (s.section ? ' · ' + s.section : '') + (s.page ? ' · p.' + s.page : '');
          const txt = document.createElement('div'); txt.className = 'copx-src-text';
          txt.textContent = s.text || '';
          wrap.appendChild(lbl); wrap.appendChild(txt); into.appendChild(wrap);
        });
      };
    }

    pill('warn', '⚠', warns.length, lines(warns.map(function (f) { return { text: f.message || '', warn: true }; })));
    pill('note', 'ℹ', noteLines.length, lines(noteLines));
    pill('src', '📄', guides.length, sources(guides));

    bot.appendChild(bar);
    bot.appendChild(panel);

    // Safety: a warning is auto-expanded on render — never hidden behind a click.
    if (warns.length && bar.firstChild && bar.firstChild.__open) { bar.firstChild.__open(); }

    log.scrollTop = log.scrollHeight;
  }

  // Mint a session token for the selected pid (same-origin; ownership enforced server
  // side). A new patient resets the cached token and the conversation.
  async function getToken(force) {
    if (token && !force) return token;
    const pid = pidEl.value;
    // POST the mint request: minting a credential is state-changing, and keeping the
    // CSRF token + pid out of the URL prevents them leaking to access logs / history.
    const body = new URLSearchParams({ pid: pid, csrf_token_form: CSRF });
    const r = await fetch(MODULE_BASE + '/public/session-token.php', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!r.ok) {
      let msg = 'HTTP ' + r.status;
      try { msg = (await r.json()).error || msg; } catch (e) {}
      throw new Error('Could not start a session: ' + msg);
    }
    token = (await r.json()).token;
    return token;
  }

  async function postChat(force) {
    const t = await getToken(force);
    return fetch(AGENT_BASE + '/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + t },
      body: JSON.stringify({ messages }),
    });
  }

  if (pidEl) {
    pidEl.addEventListener('change', () => { token = null; messages = []; log.innerHTML = ''; });
    document.getElementById('f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = document.getElementById('q').value.trim();
      if (!q) return;
      const send = document.getElementById('send'); send.disabled = true;
      document.getElementById('q').value = '';
      const um = bubble('user'); um.textContent = q; messages.push({ role: 'user', content: q });
      const bot = bubble('bot'); const typing = typingEl(); bot.appendChild(typing);
      try {
        let res = await postChat(false);
        if (res.status === 401) { res = await postChat(true); } // token expired -> re-mint once
        if (!res.ok) { bot.textContent = 'Error: HTTP ' + res.status; send.disabled = false; return; }
        const reader = res.body.getReader(); const dec = new TextDecoder();
        let buf = '', answer = '', doneData = null;
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          buf += dec.decode(value, { stream: true });
          const parts = buf.split('\n\n'); buf = parts.pop();
          for (const p of parts) {
            const line = p.split('\n').find((l) => l.startsWith('data: '));
            if (!line) continue;
            const data = JSON.parse(line.slice(6));
            if (data.delta) {
              if (typing.parentNode) typing.remove();
              answer += data.delta; bot.textContent = bodyOf(answer); log.scrollTop = log.scrollHeight;
            } else if ('verdictOk' in data) { doneData = data; }
          }
        }
        if (typing.parentNode) typing.remove();
        renderDone(bot, bodyOf(answer), doneData || { verdictOk: false, findings: [], ungrounded: [] });
        messages.push({ role: 'assistant', content: answer });
      } catch (err) { bot.textContent = 'Error: ' + err.message; }
      send.disabled = false; document.getElementById('q').focus();
    });
  }
</script>
</body>
</html>
