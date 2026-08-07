# Spec — verification layer 4: the critic gate (W2)

Status: implemented. Grounds `W2_ARCHITECTURE.md §10` ("Verification gate + critic"),
`.claude/rules/verification-gate.md`, `.claude/rules/w2-multi-agent-orchestration.md`
("no worker path bypasses the verification gate … converges through citation → grounding
→ constraint → critic before respond"), and `USERS.md` non-goals (read-only; no diagnosis,
no prescribing).

## Why

The read-only co-pilot **surfaces and flags**; it never recommends therapy or a dose
(`USERS.md` non-goals, UC-4 boundary). Layers 1–3 guarantee *traceability* (citation),
*faithfulness* (grounding judge), and *documented safety findings* (constraint engine) —
but none of them stop a **grounded, cited** claim that nonetheless oversteps into an
**action suggestion** ("start her on ferrous sulfate 325 mg"). A single such drift breaks
the physician's trust and the agent's stated boundary. The critic is the final veto that
holds that line.

## Behavior

The critic runs **last** in the gate, after the constraint engine and immediately before
`respond`. It inspects the claims that survived layers 1–2 (`state.groundedClaims`) and
**withholds** — removes from the answer body *and* the citation contract — any claim that:

1. **is uncited** — has zero `sourceRefs` (belt-and-suspenders: layer 1 already rejects
   these, so in normal flow none reach here; the critic re-asserts the invariant so no
   future edge can surface an uncited claim), or
2. **is an unsafe action suggestion** — the statement is the *agent itself* directing a
   therapeutic action (prescribe / start / initiate / titrate / adjust a dose / switch /
   "you should" / "I recommend starting" / "consider starting" / order). Detected
   **deterministically** by pattern over the statement text.

The critic is **veto-only / advisory** (`W2_ARCHITECTURE §10`): it may only *tighten* the
answer (withhold), never approve or widen. It can never overrule a deterministic block to
let something pass. Withholding is safe-by-construction — a false positive costs a dropped
sentence (the physician still sees the safety flags + a note), a false negative is the only
dangerous direction, so the detector biases toward flagging.

### The report / direct distinction (the crux)

The boundary is **who authors the action**. The agent may **report** a recommendation that
exists in the record or a retrieved guideline; it may not **direct** one itself.

| Kept (report)                                                             | Withheld (direct)                                     |
|---------------------------------------------------------------------------|-------------------------------------------------------|
| "Her ferritin is 11 ng/mL (low) and hemoglobin 11.4 g/dL (low)."          | "Start her on ferrous sulfate 325 mg."                |
| "The ADA guideline recommends a statin for diabetics over 40 [g::…]."     | "I recommend starting a statin."                      |
| "Lisinopril was discontinued in 2014 per the lists table."                | "Discontinue the lisinopril and switch to an ARB."    |
| "No preventive migraine medication is documented."                        | "Consider starting a preventive such as topiramate."  |
| "Propranolol 40 mg twice daily is on file."                               | "Increase the propranolol dose to 80 mg."             |

The precise patterns key on **agent-authored imperatives** ("start her on …", "prescribe",
"I/we recommend/suggest/advise", "you should", "consider <verb>ing", "titrate", "increase
the dose"), which third-person reporting ("the guideline recommends", "was discontinued")
does not match. Diagnosis phrasing is **out of scope** for the critic (the read-only prompt
+ grounding handle it) to avoid false-positiving legitimate problem-list reporting.

### Degradation

If the critic withholds every claim (the model produced *only* an unsafe suggestion), the
body degrades exactly as an empty-claims turn does (`DEGRADED_ANSWER[_WITH_FINDINGS]`), and
a note reports **how many** statements were withheld and why — **without echoing the unsafe
text** (same rule as the ungrounded note: never render the withheld statement, only the
count + reason). The deterministic safety findings still surface regardless.

### Optional LLM critic (seam, unwired by default)

`W2_ARCHITECTURE §10` calls for a "thin LLM critic runs last" for the *semantic* cases the
patterns miss. The seam exists (`LlmCriticFn`, applied via the pure `applyLlmVeto` fold) and
is **veto-only** by construction — it starts from the deterministic kept set and can only
*remove* more. It is **not wired into the server by default**: adding a serial LLM call to
every turn is a hot-path latency regression ("the physician has seconds"), and the eval gate
must run **offline/deterministically** (`w2-eval-gate`). The deterministic core is the
enforced, graded mechanism; the LLM seam is available to wire when latency budget allows.

## Boundaries

- The critic touches the **answer path only — never a write** (`W2_ARCHITECTURE §10`).
- It never *adds* a claim, never rewrites a statement, never approves anything a lower
  layer blocked. Withhold-or-keep only.
- The deterministic detector runs on the claim **statement text** — this is a policy check
  on the *form of the answer* (is the agent prescribing?), NOT deriving a clinical fact from
  prose. It does not feed the constraint engine and does not read the structured facts.
- No PHI or withheld statement text is logged or shipped to the client — count + reason only.

## Acceptance criteria

- **AC1** Given a claim whose statement is an agent-authored action suggestion (e.g. "Start
  her on ferrous sulfate 325 mg"), `critique` withholds it with reason
  `unsafe-action-suggestion`.
- **AC2** Given a reporting claim that mentions a therapy but does not direct one (e.g. "The
  ADA guideline recommends a statin …", "Propranolol 40 mg twice daily is on file"),
  `critique` keeps it.
- **AC3** Given a claim with zero `sourceRefs`, `critique` withholds it with reason `uncited`.
- **AC4** End-to-end: a stub `generate` that emits an unsafe suggestion produces an answer
  body that contains **no** prescribing language, a withheld note ("1 statement … withheld"),
  and no withheld statement in `groundedClaims` / the citation contract; the safety findings
  still appear.
- **AC5** A normal grounded turn is unchanged — every kept claim renders, `withheld` is empty.
- **AC6** `applyLlmVeto` only ever removes from the kept set (veto-only); an LLM critic that
  flags nothing is a no-op; an LLM critic error degrades to the deterministic kept set (the
  turn never crashes).
- **AC7** The critic is a thin node over the pure `critique` module (`orchestrator-only`);
  the graph reaches it on **every** path (no edge bypasses citation → grounding → constraint
  → critic → respond).

## Test plan

- Unit (`packages/verification/test/critic.test.ts`): AC1–AC3, AC6, plus a table of
  report-vs-direct examples and the "no withheld text echoed" invariant.
- Graph (`apps/agent/test/graph-critic.test.ts`): AC4, AC5, AC7 end-to-end via
  `buildAgentGraph` with a stub generate.
- Eval golden case (`evals/w2/cases/…`, `safe_refusal` category): an unsafe generation is
  caught by the gate — the deterministic, offline proof that ties into the eval CI gate.
