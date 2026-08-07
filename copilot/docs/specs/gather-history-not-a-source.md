# Spec: gather must not treat prior assistant answers as a data source

## Context

The `gather` node (agentic optional-tool fetch) runs a Claude tool-selection loop:
the model is shown the optional tools (vitals/labs/immunizations) and calls the ones
the last user message needs. It is handed the **full conversation history**, including
the co-pilot's own prior assistant answers.

**Bug:** when an earlier assistant turn already contains the answer (e.g. a patient
summary that lists "Influenza vaccine … 2025-10-01"), the gather model concludes the
data is "already in context" and calls **no tool**. But facts are rebuilt from tools
every turn — the assistant's prior prose is **not a citable source** — so `generate`
has no immunization row, produces nothing groundable, and the turn degrades to
"I couldn't confirm a direct answer from the record." Reproduced live: the same
question answers correctly with no history, and degrades with the summary in history.

## Behavior

Before the gather model sees the conversation, sanitize it:

- **Assistant turns:** replace the content with a neutral placeholder that carries no
  chart data (e.g. `[earlier answer — not a data source]`). The `assistant` role is
  **preserved** so turn structure/alternation is intact.
- **User turns:** pass through unchanged, in order — follow-up questions keep their
  antecedent context ("and her flu shot?" after "what vaccines has she had?").

The gather system prompt additionally states that earlier assistant turns are prior
answers, not data, and the needed data must be fetched even if a previous answer
mentioned it. (Defense in depth — the sanitization is the structural guarantee; the
prompt is the belt-and-suspenders.)

## Boundaries

- Does **not** change tool definitions, the pid binding, or the fetch/accumulate logic.
- Does **not** change what `generate` sees or the verification gate.
- Does **not** drop or reorder user turns.
- Applies only to the gather (tool-selection) step; the answer is still written by the
  grounded `generate` node from freshly-fetched facts.

## Acceptance criteria

- **AC1:** an assistant turn whose content contains chart data (e.g. a date, a med) is
  replaced with the placeholder — the sanitized content does not contain that data.
- **AC2:** user turns are unchanged (content byte-identical) and keep their order.
- **AC3:** role sequence is preserved (an assistant turn stays an assistant turn).
- **AC4 (behavioral, live):** "when did she get her flu shot" answered *with* a prior
  summary in history now returns the immunization date rather than degrading.

## Open questions

- None. The placeholder wording is not load-bearing (any data-free string works);
  chosen for readability in traces.
