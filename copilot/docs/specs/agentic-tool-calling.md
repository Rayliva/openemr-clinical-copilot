# Spec — Agentic tool-calling (safety core always-on + LLM-selected optional tools)

Status: **Approved, in build** (branch `feat/floating-agent`). Replaces "fetch every tool
every turn" with: always-fetch the safety-critical core, let the LLM decide which *optional*
tools to call. Decided with the user. Governed by `.claude/rules/verification-gate.md`,
`.claude/rules/authorization-and-pid-scope.md`, `.claude/rules/phi-and-secrets.md`
(minimum-necessary), `.claude/rules/orchestrator-only.md`.

## Problem

`assembleContext` fetches **all** tools in parallel every turn. That was justified for the
safety gate (the constraint engine needs meds+allergies+problems even when unasked, to catch
a contraindication the physician didn't ask about) — but it does **not** justify fetching
vitals, labs, encounters, dispense, procedures, documents, coverage on every turn. As the
tool count grows (full chart coverage), fetch-all means 12+ FHIR reads for "what's her name?",
pushes the load-test FHIR-saturation ceiling, and violates minimum-necessary (stuffing every
category into the LLM prompt).

## Design

Two fetch tiers:

- **Safety core — always fetched** (`assembleContext`, deterministic): demographics, problems,
  medications, allergies. These feed the **constraint engine** every turn (unchanged). Small,
  bounded, non-negotiable — the safety guarantee depends on them being present regardless of
  the question.
- **Optional — LLM-selected** (new `gather` node): vitals, labs, and every future Phase B
  tool (dispense, procedures, diagnostic reports, coverage, documents, care plans). The model
  is given these as callable tools and invokes only what the question needs.

### The `gather` node
- A bounded LLM tool-calling loop (`generateText` + tools + `maxSteps`). The model is
  instructed: the core chart is already loaded; call the tools needed to answer THIS question;
  do not answer, only gather.
- **Authz:** each optional tool exposed to the model takes **no arguments** — its `execute`
  closes over the session-bound `patientId` from state. The model calls `getVitals()` with no
  args; pid never comes from the model (`authorization-and-pid-scope`).
- Each `execute` fetches via the real tool, and the result is accumulated into the facts. After
  the loop, `retrievedRefs` and the `evidenceIndex` are **recomputed over the enriched facts**
  using the existing pure functions — so citations to gathered rows resolve in the gate.
- **Injectable + skippable:** when no gather model is wired (tests / cost-off), the node is a
  no-op — optional facts stay null, core-only behavior. Like the grounding judge.
- The model's text output is **discarded** — gather only fetches. The answer is still produced
  by the pure `generate` node on the enriched facts, so the citation/grounding/constraint gate
  and the regenerate-with-feedback loop are entirely unchanged.

### Flow
`assembleContext` (core) → **`gather`** (LLM picks + fetches optional) → `generate` →
`verify` → `grounding` → `constraints` (on core) → `respond`. Only the first two nodes change.

## Boundaries

- **The verification gate is untouched.** generate/verify/grounding/constraints/respond operate
  on the enriched facts exactly as today; nothing user-facing bypasses the gate.
- **The constraint engine still runs on the always-present core** (meds+allergies+problems) —
  contraindication/conflict/duplicate checks never depend on the LLM's tool choices.
- **pid is never a model-supplied argument.** Optional tools take no args; execute uses the
  bound pid. This is the load-bearing authz invariant.
- The LLM *may* fail to call a tool it should (the accepted tradeoff of model-driven selection).
  A missed optional fetch degrades to "not documented," never a wrong answer — and never
  affects the deterministic safety findings.
- Tool descriptions are curated so the model selects well; selection is not a new safety surface
  (optional data isn't a constraint input).

## Acceptance criteria

1. The safety core (demographics, problems, meds, allergies) is fetched every turn regardless
   of the question; the constraint engine's findings are identical to today for the same data.
2. Optional tools (vitals, labs, …) are fetched **only** when the model calls them; a question
   that doesn't need them triggers zero optional FHIR reads.
3. A vitals/labs question causes the model to call that tool, the result is fetched, and the
   answer is grounded + cited against the gathered rows (evidence index resolves them).
4. Optional tools exposed to the model take no pid argument; pid comes from the bound session.
5. With no gather model wired, the graph runs core-only with no errors (existing tests pass
   unchanged).
6. A tool failure inside gather degrades that source to unavailable (labeled), never crashes
   the turn (existing per-source isolation preserved).

## Migration note

Vitals + labs (slices 2–3) move from pre-fetched to gather-fetched — the tools/mappers are
unchanged; only *when* they're called changes. Encounters (slice 4) and all Phase B tools are
added as optional (gather) tools, not pre-fetch fan-out.
