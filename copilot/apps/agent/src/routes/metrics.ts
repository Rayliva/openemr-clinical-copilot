import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { evaluateAlerts, firingAlerts, type MetricsRegistry, type MetricsSnapshot } from "@copilot/metrics";

/**
 * `GET /metrics` (JSON) and `GET /dashboard` (HTML): the live operational window.
 *
 * Neither route carries PHI — tool names, counts, and latencies only. They do reveal
 * traffic volume and error posture, so both sit behind a bearer token. When no token
 * is configured the routes are not registered at all (fail-closed, not fail-open).
 *
 * Durable history lives in Langfuse; this is "right now", which is what an alert
 * evaluates. Spec: docs/specs/observability-dashboard.md
 */

export interface MetricsRoutesOptions {
  readonly metrics: MetricsRegistry;
  readonly token: string;
}

function tokenMatches(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function bearer(header: string | undefined): string | null {
  if (header === undefined || !header.startsWith("Bearer ")) {
    return null;
  }
  return header.slice("Bearer ".length);
}

/**
 * A `?token=` query param is accepted in addition to the Authorization header. A
 * browser cannot attach a bearer header on plain navigation, and this page's
 * auto-refresh must survive, so the token is allowed in the URL for local viewing.
 * The header remains the primary path (what E7's alert runner uses).
 */
function queryToken(query: unknown): string | null {
  if (typeof query !== "object" || query === null) {
    return null;
  }
  const value = (query as { token?: unknown }).token;
  return typeof value === "string" ? value : null;
}

function formatMs(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)} ms`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

function renderToolRows(snapshot: MetricsSnapshot): string {
  const names = Object.keys(snapshot.tools).sort();
  if (names.length === 0) {
    return `<tr><td colspan="4" class="muted">No tool calls recorded yet.</td></tr>`;
  }
  return names
    .map((name) => {
      const tool = snapshot.tools[name];
      if (tool === undefined) {
        return "";
      }
      const failing = tool.failuresTotal > 0;
      return `<tr>
        <td>${escapeHtml(name)}</td>
        <td>${tool.callsTotal}</td>
        <td class="${failing ? "bad" : ""}">${tool.failuresTotal}</td>
        <td>${formatMs(tool.latencyMs.p95)}</td>
      </tr>`;
    })
    .join("");
}

function rate(numerator: number, denominator: number): string {
  return denominator === 0 ? "—" : formatPercent(numerator / denominator);
}

/** W2 per-doc-type ingestion rows (PHI-free: doc type + counts only). */
function renderDocTypeRows(snapshot: MetricsSnapshot): string {
  const names = Object.keys(snapshot.ingestion.byDocType).sort();
  if (names.length === 0) {
    return `<tr><td colspan="4" class="muted">No documents ingested yet.</td></tr>`;
  }
  return names
    .map((name) => {
      const d = snapshot.ingestion.byDocType[name];
      if (d === undefined) {
        return "";
      }
      return `<tr>
        <td>${escapeHtml(name)}</td>
        <td>${d.total}</td>
        <td>${d.ok}</td>
        <td class="${d.degraded > 0 ? "bad" : ""}">${d.degraded}</td>
      </tr>`;
    })
    .join("");
}

/** W2 supervisor routing-decision rows (target → count). */
function renderRouteRows(snapshot: MetricsSnapshot): string {
  const names = Object.keys(snapshot.supervisor.routes).sort();
  if (names.length === 0) {
    return `<tr><td colspan="2" class="muted">No supervisor routing recorded yet.</td></tr>`;
  }
  return names
    .map((name) => `<tr><td>${escapeHtml(name)}</td><td>${snapshot.supervisor.routes[name] ?? 0}</td></tr>`)
    .join("");
}

/**
 * The Week-2 dashboard sections: document ingestion, guideline retrieval, and supervisor routing.
 * PHI-free (counts, latencies, doc types, and match states only). `Queue depth = N/A` per
 * W2_ARCHITECTURE §9 (lazy detection, no background worker).
 */
function renderW2Sections(snapshot: MetricsSnapshot): string {
  const ing = snapshot.ingestion;
  const ret = snapshot.retrieval;
  const totalFields = ing.fieldsLocated + ing.fieldsForcedReview;

  return `
<h2>Document ingestion (W2)</h2>
<div class="cards">
  <div class="card"><div class="label">Documents</div><div class="value">${ing.documentsTotal}</div></div>
  <div class="card"><div class="label">Extraction ok</div><div class="value good">${ing.extractionOk}</div></div>
  <div class="card"><div class="label">Extraction degraded</div><div class="value ${ing.extractionDegraded > 0 ? "bad" : ""}">${ing.extractionDegraded}</div></div>
  <div class="card"><div class="label">Located rate</div><div class="value">${rate(ing.fieldsLocated, totalFields)}</div></div>
  <div class="card"><div class="label">Extract p50</div><div class="value">${formatMs(ing.extractionLatencyMs.p50)}</div></div>
  <div class="card"><div class="label">Extract p95</div><div class="value">${formatMs(ing.extractionLatencyMs.p95)}</div></div>
  <div class="card"><div class="label">Queue depth</div><div class="value muted">N/A</div></div>
</div>
<table>
  <tr><th>Doc type</th><th>Total</th><th>Ok</th><th>Degraded</th></tr>
  ${renderDocTypeRows(snapshot)}
</table>
<div class="sub" style="margin-top:.5rem">
  Located = value tied to a tight box; the rest are forced to physician review (an approximate/absent
  box is a forced review, never a silent fill). Queue depth is N/A in v1 (lazy detection, no worker).
</div>

<h2>Guideline retrieval (W2)</h2>
<div class="cards">
  <div class="card"><div class="label">Queries</div><div class="value">${ret.queriesTotal}</div></div>
  <div class="card"><div class="label">Snippets</div><div class="value">${ret.snippetsTotal}</div></div>
  <div class="card"><div class="label">Zero-hit</div><div class="value ${ret.zeroHitQueries > 0 ? "" : "good"}">${ret.zeroHitQueries}</div></div>
  <div class="card"><div class="label">Rerank used</div><div class="value good">${ret.rerankUsed}</div></div>
  <div class="card"><div class="label">Rerank degraded</div><div class="value ${ret.rerankDegraded > 0 ? "bad" : ""}">${ret.rerankDegraded}</div></div>
  <div class="card"><div class="label">Retrieval p50</div><div class="value">${formatMs(ret.latencyMs.p50)}</div></div>
  <div class="card"><div class="label">Retrieval p95</div><div class="value">${formatMs(ret.latencyMs.p95)}</div></div>
</div>
<div class="sub" style="margin-top:.5rem">
  A zero-hit query answers "no supporting guideline evidence" (absence, not a negative finding).
  Rerank "degraded" = the fused pre-rerank top-N was served (unreranked fallback); answers still flow.
</div>

<h2>Supervisor routing (W2)</h2>
<div class="cards">
  <div class="card"><div class="label">Turns routed</div><div class="value">${snapshot.supervisor.turnsRouted}</div></div>
  <div class="card"><div class="label">Hop-cap hits</div><div class="value ${snapshot.supervisor.hopCapHits > 0 ? "bad" : ""}">${snapshot.supervisor.hopCapHits}</div></div>
</div>
<table>
  <tr><th>Route target</th><th>Decisions</th></tr>
  ${renderRouteRows(snapshot)}
</table>
<div class="sub" style="margin-top:.5rem">
  Each row is a routing decision the supervisor made. A hop-cap hit means the loop backstop fired
  (the router did not converge to <code>ready</code> within the hop bound) and the turn degraded.
</div>

<h2>Eval categories (W2)</h2>
<div class="sub">
  Deterministic per-encounter eval pass rate per category — backs the <code>eval_regression_detection</code>
  alert (&gt;5% failing in any category fires). Sampled ${snapshot.eval.sampled} turn(s).
</div>
<table>
  <tr><th>Category</th><th>Pass</th><th>Total</th><th>Pass rate</th></tr>
  ${renderEvalRows(snapshot)}
</table>
`;
}

/** W2 eval-category pass-rate rows (category → pass/total → rate). */
function renderEvalRows(snapshot: MetricsSnapshot): string {
  const names = Object.keys(snapshot.eval.categories).sort();
  if (names.length === 0) {
    return `<tr><td colspan="4" class="muted">No eval outcomes recorded yet.</td></tr>`;
  }
  return names
    .map((name) => {
      const category = snapshot.eval.categories[name];
      const total = category?.total ?? 0;
      const pass = category?.pass ?? 0;
      const rate = total === 0 ? 1 : pass / total;
      return `<tr><td>${escapeHtml(name)}</td><td>${pass}</td><td>${total}</td><td class="${rate < 0.95 ? "bad" : ""}">${(rate * 100).toFixed(0)}%</td></tr>`;
    })
    .join("");
}

function renderDashboard(snapshot: MetricsSnapshot, startedAt: Date): string {
  const errorClass = snapshot.errorRate > 0 ? "bad" : "good";
  const verificationTotal = snapshot.verificationPassTotal + snapshot.verificationFailTotal;
  const passRate = verificationTotal === 0 ? 0 : snapshot.verificationPassTotal / verificationTotal;

  return `<!doctype html>
<meta charset="utf-8">
<title>Clinical Co-Pilot — operations</title>
<meta http-equiv="refresh" content="10">
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; max-width: 60rem; color: #1a1a1a; }
  h1 { font-size: 1.4rem; margin-bottom: .25rem; }
  .sub { color: #666; font-size: .85rem; margin-bottom: 1.5rem; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: 1rem; }
  .card { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; }
  .card .label { font-size: .75rem; text-transform: uppercase; color: #666; letter-spacing: .04em; }
  .card .value { font-size: 1.6rem; font-weight: 600; margin-top: .25rem; }
  .good { color: #147a3d; } .bad { color: #b3261e; } .muted { color: #888; }
  table { border-collapse: collapse; width: 100%; margin-top: .5rem; }
  th, td { text-align: left; padding: .5rem .75rem; border-bottom: 1px solid #eee; font-size: .9rem; }
  th { font-size: .75rem; text-transform: uppercase; color: #666; letter-spacing: .04em; }
  h2 { font-size: 1rem; margin-top: 2rem; }
  .note { background: #fbf7e8; border: 1px solid #e6d9a8; border-radius: 6px; padding: .75rem 1rem;
          font-size: .85rem; margin-top: .5rem; }
</style>
<h1>Clinical Co-Pilot — operations</h1>
<div class="sub">
  Live window over the last ${snapshot.windowSize} turns. Counters reset on restart
  (process up since ${startedAt.toISOString()}). Durable history lives in Langfuse.
  Auto-refreshes every 10s.
</div>

<div class="cards">
  <div class="card"><div class="label">Requests</div><div class="value">${snapshot.requestsTotal}</div></div>
  <div class="card"><div class="label">Failed</div><div class="value ${errorClass}">${snapshot.requestsFailed}</div></div>
  <div class="card"><div class="label">Error rate</div><div class="value ${errorClass}">${formatPercent(snapshot.errorRate)}</div></div>
  <div class="card"><div class="label">Latency p50</div><div class="value">${formatMs(snapshot.latencyMs.p50)}</div></div>
  <div class="card"><div class="label">Latency p95</div><div class="value">${formatMs(snapshot.latencyMs.p95)}</div></div>
  <div class="card"><div class="label">Retries</div><div class="value muted">${snapshot.retriesTotal}</div></div>
</div>

<h2>Verification gate</h2>
<div class="cards">
  <div class="card"><div class="label">Verification pass</div><div class="value good">${snapshot.verificationPassTotal}</div></div>
  <div class="card"><div class="label">Verification fail</div><div class="value ${snapshot.verificationFailTotal > 0 ? "bad" : ""}">${snapshot.verificationFailTotal}</div></div>
  <div class="card"><div class="label">Pass rate</div><div class="value">${formatPercent(passRate)}</div></div>
</div>
<div class="sub" style="margin-top:.5rem">
  A "fail" is a turn that ended unverified — a claim was dropped by the grounding judge
  or a citation did not resolve. The answer still degraded gracefully; it is not an error.
</div>

<h2>Tools</h2>
<table>
  <tr><th>Tool</th><th>Calls</th><th>Failures</th><th>p95</th></tr>
  ${renderToolRows(snapshot)}
</table>
<div class="sub" style="margin-top:.5rem">
  A failed tool read degrades that one source; the turn still answers from the rest.
</div>

${renderW2Sections(snapshot)}

${
  snapshot.retryPathImplemented
    ? ""
    : `<div class="note"><strong>Retries: no retry path is implemented.</strong> The counter above
       reads zero because nothing in the agent retries — it is not that retries are firing and
       succeeding. The bounded regenerate-with-feedback prescribed by the verification-gate rule
       is a known, tracked gap.</div>`
}
`;
}

export function metricsRoutes({ metrics, token }: MetricsRoutesOptions) {
  const startedAt = new Date();

  return async function register(app: FastifyInstance): Promise<void> {
    // Scoped to this plugin by Fastify encapsulation, so it guards exactly the two
    // routes below and nothing else. No path matching — a query string or a trailing
    // slash must not be able to slip past the gate.
    app.addHook("onRequest", async (request, reply) => {
      const supplied = bearer(request.headers.authorization) ?? queryToken(request.query);
      if (supplied === null || !tokenMatches(supplied, token)) {
        await reply.code(401).send({ error: "unauthorized" });
      }
    });

    app.get("/metrics", async () => metrics.snapshot());

    app.get("/dashboard", async (_request, reply) => {
      await reply.type("text/html; charset=utf-8").send(renderDashboard(metrics.snapshot(), startedAt));
    });

    // Alert evaluation (E7): the same /metrics snapshot, run through the deterministic
    // rule set. On request; an operator poller (documented in docs/oncall.md) drives it
    // on an interval. A firing rule is logged structured — the v1 delivery path, no PHI,
    // no external service. Spec: docs/specs/alerts-and-oncall.md
    app.get("/alerts", async (request) => {
      const outcomes = evaluateAlerts(metrics.snapshot());
      const firing = firingAlerts(outcomes);
      for (const alert of firing) {
        const log = alert.status === "critical" ? request.log.error : request.log.warn;
        log.call(request.log, { alert: alert.name, value: alert.value, threshold: alert.threshold }, "alert firing");
      }
      // `alerts` lists EVERY defined rule (name + status + value + threshold + description) so each
      // alert is discoverable by name regardless of state; `firing` is the warning/critical subset.
      return { status: firing.length > 0 ? "firing" : "ok", alerts: outcomes, firing };
    });
  };
}
