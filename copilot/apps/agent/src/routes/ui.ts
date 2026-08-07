import type { FastifyPluginAsync } from "fastify";

/** Minimal self-contained dev chat page (no build step) served at `GET /`. */
const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Clinical Co-Pilot — dev chat</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0; background: #0f1115; color: #e6e6e6; }
  header { padding: 12px 16px; background: #161922; border-bottom: 1px solid #2a2f3a; }
  header b { color: #7db4ff; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 16px; }
  .row { display: flex; gap: 8px; margin-bottom: 12px; }
  input, textarea, button { font: inherit; border-radius: 8px; border: 1px solid #2a2f3a; background: #1b1f2a; color: #e6e6e6; padding: 8px 10px; }
  input[readonly] { color: #8b93a7; }
  #log { min-height: 300px; }
  .msg { padding: 10px 12px; border-radius: 10px; margin: 8px 0; white-space: pre-wrap; }
  .user { background: #21324a; }
  .bot { background: #1b1f2a; border: 1px solid #2a2f3a; }
  .meta { font-size: 12px; color: #8b93a7; margin-top: 4px; }
  form { display: flex; gap: 8px; }
  #q { flex: 1; }
  button { background: #2a5bd7; border-color: #2a5bd7; cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
  .typing i { display:inline-block; width:6px; height:6px; margin:0 2px; border-radius:50%; background:#8b93a7; animation: blink 1.2s infinite both; }
  .typing i:nth-child(2){ animation-delay:.2s } .typing i:nth-child(3){ animation-delay:.4s }
  @keyframes blink { 0%,80%,100%{ opacity:.2 } 40%{ opacity:1 } }
  .chips { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
  .chip { font-size:12px; padding:3px 8px; border-radius:999px; border:1px solid transparent; white-space:normal; }
  .chip.warn { background:#3a2e17; border-color:#7a5b1e; color:#ffcf7d; }
  .chip.info { background:#20242e; border-color:#2a2f3a; color:#9aa3b7; }
  .verdict { font-size:12px; margin-top:8px; }
  .verdict.ok { color:#7fd18b; } .verdict.warn { color:#ffcf7d; }
  .unverified { font-size:12px; color:#8b93a7; margin-top:4px; font-style:italic; }
  .sources { display:flex; flex-wrap:wrap; align-items:center; gap:5px; margin-top:8px; }
  .sources-label { font-size:12px; color:#8b93a7; }
  .src-ref { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:11px; padding:2px 7px; border-radius:6px; background:#1b2a20; border:1px solid #2d5a3a; color:#7fd18b; cursor:help; }
</style>
</head>
<body>
<header><b>Clinical Co-Pilot</b> — dev chat (read-only, cited)</header>
<div class="wrap">
  <div class="row">
    <input id="pid" value="a2326abc-c03c-4b9e-8af9-b7e03a9b4362" style="flex:1" title="patient FHIR id" />
  </div>
  <div id="log"></div>
  <form id="f">
    <input id="q" placeholder="Ask about this patient…" autocomplete="off" />
    <button id="send" type="submit">Send</button>
  </form>
</div>
<script>
  const log = document.getElementById('log');
  const messages = [];
  // Boundary #1: the pid is bound by a signed token, not the request body. In dev we
  // fetch one from the local mint stand-in (GET /dev/session-token); prod uses the
  // OpenEMR bridge. Cached and re-minted on a 401.
  let token = null;
  async function getToken(force) {
    if (token && !force) return token;
    const pid = document.getElementById('pid').value.trim();
    const r = await fetch('/dev/session-token?patientFhirId=' + encodeURIComponent(pid));
    if (!r.ok) throw new Error('mint failed: HTTP ' + r.status + ' (is COPILOT_DEV_MINT=true?)');
    token = (await r.json()).token;
    return token;
  }
  async function postChat(force) {
    const t = await getToken(force);
    return fetch('/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + t },
      body: JSON.stringify({ messages }),
    });
  }
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
  // The answer body is everything before the appended, deterministic sections; those
  // render as chips instead of raw text.
  function bodyOf(text) {
    let cut = text.length;
    for (const m of ['\\n\\nSafety flags:', '\\n\\nCould not verify']) {
      const i = text.indexOf(m); if (i >= 0 && i < cut) cut = i;
    }
    return text.slice(0, cut).trim();
  }
  function renderDone(bot, body, data) {
    bot.textContent = body || 'I can\\'t confirm that from the record.';
    const v = document.createElement('div');
    v.className = 'verdict ' + (data.verdictOk ? 'ok' : 'warn');
    v.textContent = data.verdictOk ? '✓ cited & verified' : '⚠ could not fully verify';
    bot.appendChild(v);
    if (data.findings && data.findings.length) {
      const chips = document.createElement('div'); chips.className = 'chips';
      for (const f of data.findings) {
        const c = document.createElement('span');
        c.className = 'chip ' + (f.severity === 'warning' ? 'warn' : 'info');
        c.textContent = (f.severity === 'warning' ? '⚠ ' : 'ℹ ') + f.message;
        chips.appendChild(c);
      }
      bot.appendChild(chips);
    }
    if (data.ungrounded && data.ungrounded.length) {
      const u = document.createElement('div'); u.className = 'unverified';
      // Reason only, never the dropped statement text (server no longer sends it).
      u.textContent = data.ungrounded.length + ' statement(s) omitted as unverified (' +
        Array.from(new Set(data.ungrounded.map((x) => x.reason))).join('; ') + ')';
      bot.appendChild(u);
    }
    // The machine-readable citation contract, rendered: each grounded claim maps to the source
    // chart row(s) backing it. Group by row so a row cited by several claims shows once; hovering a
    // badge reveals which claim(s) it supports. These are the leak-safe verified claims only.
    if (data.citations && data.citations.length) {
      const byRef = {};
      for (const c of data.citations) {
        for (const ref of (c.sourceRefs || [])) { (byRef[ref] = byRef[ref] || []).push(c.statement); }
      }
      const refs = Object.keys(byRef);
      if (refs.length) {
        const src = document.createElement('div'); src.className = 'sources';
        const label = document.createElement('span'); label.className = 'sources-label';
        label.textContent = 'Sources (' + refs.length + '): ';
        src.appendChild(label);
        for (const ref of refs) {
          const b = document.createElement('span'); b.className = 'src-ref';
          b.textContent = ref; b.title = byRef[ref].join(' • ');
          src.appendChild(b);
        }
        bot.appendChild(src);
      }
    }
    log.scrollTop = log.scrollHeight;
  }
  // A new patient id invalidates the cached token (it is bound to one pid).
  document.getElementById('pid').addEventListener('input', () => { token = null; });
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
        const parts = buf.split('\\n\\n'); buf = parts.pop();
        for (const p of parts) {
          const line = p.split('\\n').find((l) => l.startsWith('data: '));
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
    } catch (err) { bot.textContent = 'Error: ' + err; }
    send.disabled = false; document.getElementById('q').focus();
  });
</script>
</body>
</html>`;

export const uiRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (_request, reply) => {
    reply.header("content-type", "text/html; charset=utf-8");
    return PAGE;
  });
};
