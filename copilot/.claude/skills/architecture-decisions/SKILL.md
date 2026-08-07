---
name: architecture-decisions
description: The locked architectural decisions for the Clinical Co-Pilot and the alternatives that were rejected, with reasons — sidecar vs in-monolith, FHIR API vs direct DB read, cached snapshot vs live reads, deterministic vs LLM verification, self-hosted vs SaaS tracing, model tiering, deploy shape. Use before adding or moving a component, changing how data is read or cached, choosing a model or provider, changing the deploy, or whenever tempted to propose a structural shortcut.
---

# Skill: architecture-decisions

## When to use
Before any **structural** change: adding or relocating a component, changing the
data-access path, altering caching, picking a model, or changing deployment. Also
read this the moment a "simpler" approach seems obvious — it was probably already
considered and rejected for a reason recorded below.

Full detail: **`../ARCHITECTURE.md`**. Section numbers map to it. The invariants
these decisions imply are enforced as rules in `../.claude/rules/` — this skill is
the *why*, the rules are the *what*.

## Locked decisions

**The agent is a separate TypeScript service, not code in the PHP monolith (§2.1).**
OpenEMR stays the system of record. Its only footprint is a thin module:
a chat panel and an identity bridge. No clinical logic in PHP.

**Authorization is enforced above OpenEMR (§3).** The module mints a short-lived
HMAC-signed token `{user_id, pid, correlation_id, exp}`, and only for a `pid` the
logged-in physician owns (`patient_data.providerID`). The agent re-checks the
binding and queries only that pid. This exists because OpenEMR's ACL is role-level,
not row-level — the OAuth client is *knowingly* over-privileged at the OpenEMR
layer, and this is the compensating control. Documented, not hidden.

**Verification is defense-in-depth, and the safety-bearing layer is deterministic
(§2.5).** Citation check (deterministic) → grounding judge (LLM, sees only the
cited source) → clinical-constraint engine (deterministic, on structured facts).
Contraindication detection is never probabilistic.

**Latency is solved by a cached, reconciled Patient Snapshot (§2.3, §5).** Chart
assembly is inherent multi-table fan-out with no cache in OpenEMR. Precompute the
snapshot, tag every field with provenance, cache in Redis, answer the fast path
from memory. Fire deep tools only on demand.

**Observability is self-hosted (§2.6).** Langfuse, not a SaaS tracer.

**Deploy shape is fixed MVP→final (§8).** One DO VM, one Compose project:
`openemr`, `mysql`, `redis`, `agent`, `langfuse`, `langfuse-db`, Caddy for TLS.
"Same infra MVP→final" means commit now, don't re-platform later.

## Rejected — do not re-propose without new evidence

**Direct MySQL read** (read-only user or replica). Fastest, and it is the shortcut
that will keep suggesting itself. **Rejected:** bypasses both OpenEMR's access
control *and* its audit trail, and couples the agent to the schema. Unacceptable
for a PHI system (§4, `AUDIT.md §5`).

**Custom PHP read endpoints.** **Rejected as primary:** moves clinical
reconciliation into the monolith, against the stay-out-of-PHP principle, and is
harder to unit-test. Retained only as a fallback if FHIR proves too chatty.

**Agent in-process inside PHP.** **Rejected:** one deploy is the only upside; loses
the toolchain (Vercel AI SDK, Zod, Langfuse, promptfoo) and puts clinical logic in a
codebase where every read is audit-amplified.

**Always-live reads (no cache).** **Rejected:** freshness lost to speed
deliberately; invalidation is by TTL and, later, OpenEMR domain events.

**LLM-only verification.** **Rejected:** flexible but unaccountable. An LLM cannot
be trusted to reliably catch a contraindication.

**Hosted tracing (e.g. LangSmith).** **Rejected:** a tracer captures prompts, tool
I/O, and completions verbatim — i.e. PHI — making it a HIPAA subprocessor needing
its own BAA. Self-hosting removes the dependency rather than relying on it
(`AUDIT.md §5.5`).

**Bulk FHIR `$export`.** Never, unless population data is genuinely required.
Minimum-necessary fields only across trust boundary #3.

## Model tiering (§5)
Sonnet for routing, most turns, and the grounding judge. Opus reserved for complex
synthesis. Everything streams.

## Known, accepted limitations (§11)
- The OpenEMR API client is over-privileged; compensated at boundary #1.
- OpenEMR's audit log is forgeable, so the agent keeps its **own append-only
  disclosure log**.
- Constraint rules are only as good as the data — the seeded penicillin allergy has
  no severity, so severity rules cannot fire. See `openemr-gotchas`.

## Related
- `../ARCHITECTURE.md` — the full document, incl. the system-context diagram.
- `openemr-gotchas` — the data-quality traps these decisions respond to.
- `../.claude/rules/` — the invariants these decisions are enforced as.
