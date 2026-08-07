# TypeScript standards

Legacy OpenEMR patterns are not the standard here (`../CLAUDE.md`). New TS code is
strict, typed, and contract-first.

## The rules
- **`strict: true`** everywhere. No implicit `any`.
- **Zod-first at boundaries.** Every tool/graph/HTTP boundary has a Zod schema;
  parse raw input into typed objects at the edge (parse, don't validate
  downstream). Export JSON Schema from Zod — never hand-write it.
- **No `any` at boundaries; narrow, don't cast.** Use `instanceof`/`typeof`/schema
  parsing to narrow `unknown`; avoid `as` except for genuinely unavoidable, local,
  commented cases.
- **Immutability by default.** `readonly` properties / value objects for DTOs,
  provenance, config; return new objects (wither-style) over mutation.
- **Domain primitives** where a raw `number`/`string` could be transposed —
  e.g. wrap `pid`, ids, coded values rather than passing bare primitives that the
  type system can't tell apart.
- **Constructor DI**; no service-locator/global reads for dependencies. No reaching
  into `process.env` deep in business logic — read config at the edge.
- **Every exported function has explicit param + return types.**

## Why
The whole design is contract-first (Zod = single source of truth); casts and `any`
silently admit invalid data into a system where wrong data is a safety issue.

## Do / Don't
- **Do:** `function summarize(pid: PatientId): Snapshot`
- **Don't:** `function summarize(pid): any`
- **Do:** `const input = ToolInput.parse(raw)`
- **Don't:** `const input = raw as ToolInput`
