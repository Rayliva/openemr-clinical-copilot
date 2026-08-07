# Error handling & logging

Failures must be transparent to the developer and safe for the user. Mirrors the
repo-root PHP standards, adapted to TypeScript.

## The rules
- **Catch only at boundaries where recovery is meaningful.** Don't catch-log-
  continue in the middle of business logic — let it propagate to a place that can
  decide (typed error → graceful degradation).
- **Never expose a raw error to the user-facing chat.** Internal messages may carry
  SQL, paths, PHI. Log the detail; show a generic, honest message ("labs
  unavailable right now").
- **Tool failures are typed and surfaced**, not swallowed — the agent continues
  with what it has; never a crash or a silent empty answer.
- **Structured JSON logs only** (pino). Pass context as an object with the
  **correlation ID**; never string-interpolate variables into the message.
- **Never log PHI or secrets** (see `phi-and-secrets`).
- **Validate model/tool output with Zod**; on malformed output, bounded retry then
  degrade.

## Why
Interpolated logs aren't queryable and leak data; exposed internals are both a UX
and a security problem; the correlation ID is what threads a request through
Langfuse.

## Do / Don't
- **Do:** `log.error({ correlationId, pid, err }, 'lab fetch failed')`
- **Don't:** `log.error(\`lab fetch failed for ${pid}: ${err.message}\`)`
- **Do:** surface `{ tool: 'getLabs', status: 'unavailable' }` to the graph.
- **Don't:** `catch (e) {}` or return `[]` as if there were no labs.
