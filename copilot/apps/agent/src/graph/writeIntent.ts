/**
 * Pure detector: does the physician's message ask the agent to WRITE to the chart (create / update /
 * delete a record)? The co-pilot is read-only (`USERS.md` non-goals) — it surfaces, reconciles, and
 * flags, it never mutates the chart. A write request short-circuits to a clear read-only refusal
 * (no LLM call, no stray safety flags), rather than degrading to the generic "I don't have that here".
 *
 * Deterministic + total, unit-tested — mirrors the shape of `supervisor.ts`'s pure `decideRoute`.
 * The patterns key on an imperative to change chart state; they deliberately do NOT fire on read
 * phrasings ("update me on Grace", "what changed since last visit", "compare her glucose to …").
 */

const WRITE_REQUEST_PATTERNS: readonly RegExp[] = [
  // "update the chart / record / her chart"
  /\bupdate\s+(the\s+|her\s+|his\s+|their\s+|this\s+patient'?s?\s+)?(chart|record|file|ehr|emr)\b/i,
  // "update/change/set/correct her X to <value>" — the demo case ("update Grace's glucose to 1000").
  // Requires an explicit "to <word>" target, so "what should I change her dose to?" (ends before a
  // value) and "compared to" (wrong verb) do not fire.
  /\b(update|change|set|correct|modify|edit|adjust|overwrite|replace)\b[^?]{0,60}\bto\s+[\w$"'\d]/i,
  // "add/enter/record/log this to/in the chart|record|note|file"
  /\b(add|enter|record|log|document|write|save|input|put|append)\b[^?]{0,60}\b(in|into|onto|on|to)\s+(the\s+|her\s+|his\s+|their\s+)?(chart|record|note|file|ehr|emr|problem list|med list|medication list)\b/i,
  // "delete/remove/clear X from the chart|record"
  /\b(delete|remove|clear|erase|drop)\b[^?]{0,60}\b(from|off|in)\s+(the\s+|her\s+|his\s+)?(chart|record|note|file)\b/i,
  // "mark it/her as resolved/active/…"
  /\bmark\b[^?]{0,40}\bas\b/i,
  // "create/start a new note/order/prescription/encounter/entry/problem/allergy/visit"
  /\b(create|start|open|add)\s+(a\s+|an\s+|new\s+)*(note|order|prescription|\brx\b|encounter|entry|problem|allergy|visit|diagnosis)\b/i,
];

/** True when the message asks the agent to create, update, or delete something in the chart. */
export function isWriteRequest(message: string): boolean {
  return WRITE_REQUEST_PATTERNS.some((re) => re.test(message));
}
