---
name: add-tool
description: Add a new capability the agent can call (getLabs, getRecentEncounters, etc.) as a Zod-contracted, provenance-returning pure module in packages/tools. Use when adding or changing any agent tool, wiring a new OpenEMR data type into the chart, or when a question the co-pilot cannot answer turns out to need a new tool.
---

# Skill: add-tool

## When to use
Adding a new capability the agent can call (e.g. `getLabs`, `getRecentEncounters`).
Every tool is a Zod-contracted, provenance-returning, **pure** module — the LLM
never touches raw data, only tool output.

## Steps

1. **Spec first** (`spec-driven-development.md`). Note the tool's behavior,
   inputs/outputs, the UC it traces to, and its failure/absence behavior.
2. **Write the Zod contracts** in `packages/tools/src/<tool>/schema.ts`:
   - Input schema (validate at the boundary — parse, don't validate downstream).
   - Output schema where **every fact carries provenance**
     `{ source_table, row_uuid, fetched_at }`.
   - Include an explicit **"no data on file"** representation distinct from an empty
     result (absence ≠ negative finding — `../AUDIT.md §4.3`).
3. **TDD the pure implementation** in `packages/tools/src/<tool>/index.ts`:
   - Write the failing Vitest first. Mock the OpenEMR client at the HTTP seam.
   - The tool reads via `packages/openemr-client` (see `openemr-fhir-read`),
     restricted to the bound `pid` — never a raw fetch, never another patient.
4. **Register** the tool in the tools registry and export its JSON Schema (from the
   Zod schema) for the LLM tool definition. Do **not** hand-write JSON Schema —
   derive it from Zod (single source of truth).
5. **Expose to the graph** via an `add-graph-node` thin wrapper — the tool module
   itself stays framework-agnostic (orchestrator-only rule).
6. Add at least one **eval case** (`add-eval-case`) if the tool changes a
   user-visible answer.

## Common pitfalls
- **Provenance is not optional.** A fact without `{source_table, row_uuid}` can't
  pass the citation check — it will be dropped by the verification gate.
- **Don't put reconciliation or clinical logic in a graph node** — it belongs in
  the pure tool/snapshot module so it's unit-testable and eval-testable.
- **Never widen the pid.** A tool that can be asked for a different patient breaks
  the authorization model — the pid comes from the signed token, not tool args.
- Return typed absence, not `null`/`[]` that reads as "nothing wrong."
