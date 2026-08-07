# PHI & secrets

This is a PHI system (synthetic data in this project, but designed as if real).
Minimum-necessary and in-boundary by default (`../AUDIT.md §5`,
`../ARCHITECTURE.md §3`).

## The rules
- **Minimum-necessary to the LLM.** Send only the fields a task needs — never whole
  charts, never bulk FHIR `$export`. Trim before the model call.
- **No PHI to any service without a BAA.** Observability stays **self-hosted**
  (Langfuse) so PHI-bearing traces never cross the trust boundary. Do not add a
  hosted tracer/analytics that would observe prompts/outputs.
- **Synthetic/seed data only** in this project. Never load real PHI.
- **Secrets are env-only** (HMAC bridge secret, OAuth2 private key, Anthropic key,
  Langfuse keys). Never committed, never in an image layer, never logged.
- **The agent keeps its own append-only disclosure log** of PHI reads, independent
  of OpenEMR's forgeable `log`/`api_log` (`../AUDIT.md §5.1`).

## Why
Every PHI field sent out is a disclosure to a Business Associate; keeping data
in-boundary removes the dependency on a chain of external BAAs. Leaked secrets =
full read access to the chart.

## Do / Don't
- **Do:** pass the three problem-list rows relevant to the question.
- **Don't:** pass the entire snapshot "just in case."
- **Do:** read `process.env.ANTHROPIC_API_KEY`.
- **Don't:** commit a `.env`, or log a token/key even at debug level.
