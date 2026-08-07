/**
 * Load / stress driver for the deployed Clinical Co-Pilot agent (E-req: load test).
 *
 * Fires concurrent POST /chat requests at the *deployed* agent and records
 * p50/p95/p99 latency, error rate, and throughput at each concurrency level, plus a
 * per-error-class breakdown. Writes a machine-readable JSON + a human summary md.
 *
 * /chat binds the patient by a signed boundary-#1 token (dev-mint is off in prod), so
 * the driver mints its own tokens with the prod bridge secret (env, never committed)
 * for real Donna-owned patients, and rotates a realistic clinical question mix so the
 * load looks like use, not one hot path. Latency = wall-clock from request send to the
 * SSE stream closing (i.e. the full answer, including the `done` event).
 *
 * Env:
 *   AGENT_URL                base URL of the deployed agent (default: prod)
 *   COPILOT_BRIDGE_SECRET    HMAC secret shared with the OpenEMR mint bridge (required)
 *   PATIENTS                 JSON [{pid,fhir}] to rotate over (required)
 *   LEVELS                   JSON [{c,n}] concurrency+count per level (default 10/100, 50/100)
 *   OUT_DIR                  output directory (default ./loadtest/results)
 *   REQ_TIMEOUT_MS           per-request timeout (default 120000)
 *   RUN_ISO                  timestamp label for the artifacts (no clock in-script)
 */
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const AGENT_URL = (process.env.AGENT_URL ?? "https://copilot.203-0-113-10.sslip.io").replace(/\/$/, "");
const SECRET = process.env.COPILOT_BRIDGE_SECRET ?? "";
const OUT_DIR = process.env.OUT_DIR ?? resolve("loadtest/results");
const REQ_TIMEOUT_MS = Number(process.env.REQ_TIMEOUT_MS ?? 120_000);
const RUN_ISO = process.env.RUN_ISO ?? "unknown";
const USER_ID = 6; // Dr. Donna Lee (users.id)

if (SECRET.length === 0) {
  console.error("COPILOT_BRIDGE_SECRET is required");
  process.exit(1);
}

/** @type {{pid:number,fhir:string}[]} */
const PATIENTS = JSON.parse(process.env.PATIENTS ?? "[]");
if (PATIENTS.length === 0) {
  console.error("PATIENTS (JSON [{pid,fhir}]) is required");
  process.exit(1);
}

/** @type {{c:number,n:number}[]} */
const LEVELS = JSON.parse(process.env.LEVELS ?? '[{"c":10,"n":100},{"c":50,"n":100}]');

// A realistic mix — a fast demographics lookup, an expensive reconciliation, an
// absence check, and an open-ended "what matters today". Mirrors real physician use.
const QUESTIONS = [
  "Who is this patient? Give name and date of birth.",
  "What medications is she on?",
  "Does she have any allergies?",
  "Anything else I should know before her visit?",
];

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const HEADER = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));

/** Mint a boundary-#1 token (same wire shape the PHP bridge signs). */
function mintToken(patient, nowSec) {
  const payload = b64url(
    JSON.stringify({
      user_id: USER_ID,
      pid: patient.pid,
      patient_fhir_id: patient.fhir,
      correlation_id: `loadtest-${RUN_ISO}-${patient.pid}`,
      exp: nowSec + 3600,
    }),
  );
  const signingInput = `${HEADER}.${payload}`;
  const sig = createHmac("sha256", SECRET).update(signingInput).digest("base64url");
  return `${signingInput}.${sig}`;
}

/** Fire one /chat request; resolve with a per-request record (never rejects). */
async function oneRequest(i, nowSec) {
  const patient = PATIENTS[i % PATIENTS.length];
  const question = QUESTIONS[i % QUESTIONS.length];
  const token = mintToken(patient, nowSec);
  const start = performance.now();
  try {
    const res = await fetch(`${AGENT_URL}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ messages: [{ role: "user", content: question }] }),
      signal: AbortSignal.timeout(REQ_TIMEOUT_MS),
    });
    if (!res.ok) {
      // Drain to free the socket; classify by status.
      await res.text().catch(() => "");
      const cls = res.status === 429 ? "http_429" : res.status >= 500 ? "http_5xx" : "http_4xx";
      return { ok: false, ms: performance.now() - start, status: res.status, cls };
    }
    const body = await res.text(); // resolves when the SSE stream closes (full answer)
    const ms = performance.now() - start;
    const complete = body.includes("event: done");
    return complete
      ? { ok: true, ms, status: res.status, cls: "ok" }
      : { ok: false, ms, status: res.status, cls: "incomplete_stream" };
  } catch (err) {
    const ms = performance.now() - start;
    const cls = err && err.name === "TimeoutError" ? "timeout" : "network";
    return { ok: false, ms, status: 0, cls };
  }
}

function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  // nearest-rank
  const rank = Math.ceil((q / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

/** Run one concurrency level: n total requests, c in flight at a time. */
async function runLevel({ c, n }, nowSec) {
  const records = new Array(n);
  let next = 0;
  const wallStart = performance.now();
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= n) return;
      records[i] = await oneRequest(i, nowSec);
    }
  }
  await Promise.all(Array.from({ length: Math.min(c, n) }, () => worker()));
  const wallMs = performance.now() - wallStart;

  const ok = records.filter((r) => r.ok);
  const okLat = ok.map((r) => r.ms).sort((a, b) => a - b);
  const errBreakdown = {};
  for (const r of records) {
    if (!r.ok) errBreakdown[r.cls] = (errBreakdown[r.cls] ?? 0) + 1;
  }
  const round = (x) => (x === null ? null : Math.round(x));
  return {
    concurrency: c,
    requests: n,
    successes: ok.length,
    failures: n - ok.length,
    errorRatePct: Number(((100 * (n - ok.length)) / n).toFixed(2)),
    errorBreakdown: errBreakdown,
    wallSeconds: Number((wallMs / 1000).toFixed(1)),
    throughputRps: Number((n / (wallMs / 1000)).toFixed(2)),
    latencyMs: {
      p50: round(quantile(okLat, 50)),
      p95: round(quantile(okLat, 95)),
      p99: round(quantile(okLat, 99)),
      min: round(okLat[0] ?? null),
      max: round(okLat[okLat.length - 1] ?? null),
      mean: okLat.length ? Math.round(okLat.reduce((a, b) => a + b, 0) / okLat.length) : null,
    },
    note: "latency percentiles computed over SUCCESSFUL requests only; error rate captures the rest",
  };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const nowSec = Math.floor(Date.now() / 1000);

  // Warmup (not measured): prime the agent + OAuth token cache so level-1 isn't cold.
  console.error("warmup (3 requests, not measured)…");
  await Promise.all([0, 1, 2].map((i) => oneRequest(i, nowSec)));

  const levels = [];
  for (const lvl of LEVELS) {
    console.error(`level: ${lvl.c} concurrent × ${lvl.n} requests …`);
    const result = await runLevel(lvl, nowSec);
    console.error(
      `  → ok ${result.successes}/${result.requests}, err ${result.errorRatePct}%, ` +
        `p50 ${result.latencyMs.p50}ms p95 ${result.latencyMs.p95}ms p99 ${result.latencyMs.p99}ms, ` +
        `${result.throughputRps} rps`,
    );
    levels.push(result);
  }

  const out = {
    target: `${AGENT_URL}/chat`,
    runIso: RUN_ISO,
    grounding: "on (prod config: Sonnet generation + Haiku grounding judge per claim)",
    patientsRotated: PATIENTS.length,
    questionMix: QUESTIONS,
    reqTimeoutMs: REQ_TIMEOUT_MS,
    levels,
  };
  writeFileSync(resolve(OUT_DIR, "loadtest-results.json"), JSON.stringify(out, null, 2));
  console.error(`wrote ${resolve(OUT_DIR, "loadtest-results.json")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
