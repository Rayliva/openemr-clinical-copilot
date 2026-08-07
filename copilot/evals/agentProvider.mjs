/**
 * promptfoo custom provider — drives the real Clinical Co-Pilot agent end-to-end.
 *
 * POSTs a case's messages to the agent `POST /chat`, assembles the streamed SSE
 * answer, and returns the full answer text (including the deterministic `Safety
 * flags` section) plus the `done` event's structured `findings` and `verdictOk` as
 * metadata. Assertions run against the observable answer — what the physician sees.
 *
 * The agent binds the patient to a signed session token (boundary #1), so `/chat`
 * requires `Authorization: Bearer <token>` — the pid is never taken from the body.
 * The provider mints that token from the agent's dev-mint stand-in, so the agent
 * must run with `COPILOT_DEV_MINT=true` + `COPILOT_BRIDGE_SECRET` set.
 *
 * Config:
 *   COPILOT_AGENT_URL — base URL of a running (new-code) agent. Default :3032.
 * Case vars:
 *   patientId — the bound patient FHIR id (defaults to Susan Underwood).
 *   messages  — optional full turn history; else `[{role:'user', content: prompt}]`.
 */

const AGENT_URL = process.env.COPILOT_AGENT_URL ?? "http://localhost:3032";
const SUSAN = "a2326abc-c03c-4b9e-8af9-b7e03a9b4362";

/** Mint a boundary-#1 session token for the bound patient via the dev-mint endpoint. */
async function mintToken(patientFhirId) {
  const url = `${AGENT_URL}/dev/session-token?patientFhirId=${encodeURIComponent(patientFhirId)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `dev-mint failed (HTTP ${res.status}) — run the agent with COPILOT_DEV_MINT=true and COPILOT_BRIDGE_SECRET set`,
    );
  }
  const body = await res.json();
  if (typeof body.token !== "string") {
    throw new Error("dev-mint returned no token");
  }
  return body.token;
}

/** Parse an SSE stream into the assembled answer + the `done` payload. */
function parseSse(raw) {
  let answer = "";
  let done = { verdictOk: false, findings: [] };
  for (const block of raw.split("\n\n")) {
    const lines = block.split("\n");
    const isDone = lines.some((l) => l.startsWith("event: done"));
    const dataLine = lines.find((l) => l.startsWith("data: "));
    if (dataLine === undefined) continue;
    let payload;
    try {
      payload = JSON.parse(dataLine.slice("data: ".length));
    } catch {
      continue;
    }
    if (isDone) {
      done = payload;
    } else if (typeof payload.delta === "string") {
      answer += payload.delta;
    }
  }
  return { answer, done };
}

export default class AgentProvider {
  id() {
    return "copilot-agent";
  }

  async callApi(prompt, context) {
    const vars = context?.vars ?? {};
    const patientId = typeof vars.patientId === "string" && vars.patientId.length > 0 ? vars.patientId : SUSAN;
    const messages = Array.isArray(vars.messages) ? vars.messages : [{ role: "user", content: prompt }];

    let res;
    try {
      const token = await mintToken(patientId);
      res = await fetch(`${AGENT_URL}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages }),
      });
    } catch (err) {
      return { error: `agent request failed at ${AGENT_URL}: ${String(err)}` };
    }
    if (!res.ok) {
      return { error: `agent returned HTTP ${res.status}` };
    }

    const { answer, done } = parseSse(await res.text());
    return {
      output: answer,
      metadata: { verdictOk: done.verdictOk ?? false, findings: done.findings ?? [] },
    };
  }
}
