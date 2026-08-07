/**
 * Verification layer 4 — the critic gate.
 *
 * Runs LAST in the verification gate (after citation → grounding → constraint, before
 * `respond`). It is the final veto that holds the read-only boundary: the co-pilot
 * **surfaces and flags**, it never recommends therapy or a dose (`USERS.md` non-goals,
 * UC-4; `W2_ARCHITECTURE.md §10`). Layers 1–3 prove traceability, faithfulness, and
 * documented safety findings — none of them stop a *grounded, cited* claim that
 * nonetheless oversteps into an **action suggestion** ("start her on ferrous sulfate").
 *
 * The critic is **veto-only / advisory**: it may only *tighten* the answer (withhold a
 * claim), never approve, widen, or overrule a lower layer to let something pass.
 * Withholding is safe-by-construction — a false positive costs a dropped sentence, a
 * false negative is the only dangerous direction — so the detector biases toward flagging.
 *
 * Detection is **deterministic** (pattern over the statement text): a policy check on the
 * *form* of the answer (is the agent prescribing?), NOT deriving a clinical fact from prose
 * (`verification-gate` rule — the constraint engine still runs only on structured facts).
 * The distinction the patterns enforce is REPORT vs DIRECT: the agent may report a
 * recommendation ("the guideline recommends a statin") but not author one ("I recommend a
 * statin"). See `docs/specs/w2-critic.md`.
 */

import type { Claim } from "./citations.js";

export type { Claim } from "./citations.js";

/** Why a claim was withheld by the critic. */
export type CriticReason = "uncited" | "unsafe-action-suggestion";

/** One claim the critic removed from the answer, with the reason (statement kept for the trace only). */
export interface WithheldClaim {
  readonly claim: Claim;
  readonly reason: CriticReason;
}

export interface CriticVerdict {
  /** True when nothing was withheld. */
  readonly ok: boolean;
  /** The claims that survive to the answer body + citation contract, in input order. */
  readonly keptClaims: readonly Claim[];
  /** The claims the critic removed. Never rendered verbatim to the physician or the logs. */
  readonly withheldClaims: readonly WithheldClaim[];
}

/**
 * Agent-authored action-suggestion patterns. Each keys on the AGENT directing a therapeutic
 * action — the verb forms are base / -s / -ing (imperative + present), deliberately NOT past
 * "-ed", so third-person history ("was discontinued", "was started on lisinopril in 2014")
 * and reporting ("the guideline recommends") are KEPT while directives are withheld.
 *
 * Documented-scope subset (like the constraint engine's drug map): the demo therapy verbs +
 * common recommendation framing. Diagnosis phrasing is intentionally out of scope (the
 * read-only prompt + grounding judge handle it) to avoid false-positiving problem-list
 * reporting. Growing this list is a data change, not a logic change.
 */
const UNSAFE_ACTION_PATTERNS: readonly RegExp[] = [
  // Statement-INITIAL imperative directive: the agent authoring an order — "Start metformin 500 mg",
  // "Add lisinopril", "Stop the lisinopril", "Order CBC", "Switch lisinopril for losartan", "Give
  // ferrous sulfate". The verb must LEAD the statement (optionally after a bullet / "please" / "let's"):
  // report + history begin with a noun/subject ("Lisinopril was discontinued", "She was started on …",
  // "The guideline recommends …", "Propranolol 40 mg is on file"), so those are KEPT. Base-form verb +
  // `\b` so a past "-ed" form ("Started …", "Stopped …", "Discontinued …") never matches — that is history.
  /^\s*(?:[-•*]\s*)?(?:please\s+|let['’]s\s+)?(?:start|begin|add|give|order|prescrib\w+|initiat\w+|titrat\w+|switch(?:es|ing)?|stop|discontinue|hold)\b/i,
  // prescribe / initiate / titrate anywhere — base, -s, -ing (never past "-ed").
  /\bprescrib(?:e|es|ing)\b/i,
  /\binitiat(?:e|es|ing)\b/i,
  /\btitrat(?:e|es|ing)\b/i,
  // "start/begin her on …", "start a/an/iron/therapy …" — the agent starting a therapy (mid-sentence).
  /\b(?:start|begin)(?:s|ing)?\s+(?:her|him|them|the patient|this patient|on|a|an|iron|insulin|therapy|treatment|supplement|replacement)\b/i,
  // "switch her to …" — the agent switching therapy.
  /\bswitch(?:es|ing)?\s+(?:her|him|them|the patient|to)\b/i,
  // "order a/an/the …" — the agent ordering a test or therapy.
  /\border(?:s|ing)?\s+(?:a|an|the)\b/i,
  // Imperative dose change: "increase the [drug] dose", "raise the dose".
  /\b(?:increase|decrease|reduce|lower|raise|double|halve)\s+(?:the\s+)?(?:\w+\s+){0,2}dos(?:e|age|ing)\b/i,
  // Imperative dose change to a NUMERIC target: "increase lisinopril to 20 mg", "raise the dose by 5"
  // (the `to|by <number>` anchor keeps a report like "an increase in creatinine" from matching).
  /\b(?:increase|decrease|reduce|raise|lower|double|halve|up-?titrate|down-?titrate)\s+(?:the\s+)?(?:her\s+|his\s+|their\s+)?[\w-]+(?:\s+[\w-]+)?\s+(?:to|by)\s+\d/i,
  // Agent-authored recommendation framing (NOT "the guideline recommends" — that has no I/we).
  /\byou\s+(?:should|could|may want to|ought to)\b/i,
  /\b(?:i|we)(?:'d)?\s+(?:would\s+)?(?:recommend|suggest|advise)\b/i,
  // "consider starting/adding/…" — a hedged suggestion is still a suggestion.
  /\bconsider\s+(?:starting|adding|prescribing|initiating|switching|increasing|decreasing|titrating|ordering|a course of)\b/i,
];

/** True when the statement is the agent itself directing a therapeutic action. */
function isUnsafeActionSuggestion(statement: string): boolean {
  return UNSAFE_ACTION_PATTERNS.some((re) => re.test(statement));
}

/** Assemble a verdict from a kept/withheld partition. */
function verdict(keptClaims: readonly Claim[], withheldClaims: readonly WithheldClaim[]): CriticVerdict {
  return { ok: withheldClaims.length === 0, keptClaims, withheldClaims };
}

/**
 * The deterministic critic. Partition claims into kept vs withheld: a claim is withheld if it
 * carries no citation (`uncited` — belt-and-suspenders over layer 1) or reads as an
 * agent-authored action suggestion (`unsafe-action-suggestion`). Kept claims preserve input
 * order. Pure + total.
 */
export function critique(claims: readonly Claim[]): CriticVerdict {
  const keptClaims: Claim[] = [];
  const withheldClaims: WithheldClaim[] = [];
  for (const claim of claims) {
    if (claim.sourceRefs.length === 0) {
      withheldClaims.push({ claim, reason: "uncited" });
    } else if (isUnsafeActionSuggestion(claim.statement)) {
      withheldClaims.push({ claim, reason: "unsafe-action-suggestion" });
    } else {
      keptClaims.push(claim);
    }
  }
  return verdict(keptClaims, withheldClaims);
}

/** The optional LLM critic's port: given the kept claims, return the INDEXES it vetoes as unsafe. */
export type LlmCriticFn = (claims: readonly Claim[]) => Promise<readonly number[]>;

/**
 * Fold an LLM critic's vetoes into an already-kept set — **veto-only** by construction: it
 * starts from `keptClaims` and can only REMOVE (never add or reorder). Out-of-range indexes are
 * ignored, so a malformed model response can never crash the turn or resurrect a claim. Every
 * removed claim is recorded `unsafe-action-suggestion` (the LLM critic's only job).
 */
export function applyLlmVeto(
  keptClaims: readonly Claim[],
  flaggedIndexes: readonly number[],
): CriticVerdict {
  const flagged = new Set(flaggedIndexes.filter((i) => Number.isInteger(i) && i >= 0 && i < keptClaims.length));
  const kept: Claim[] = [];
  const withheld: WithheldClaim[] = [];
  keptClaims.forEach((claim, i) => {
    if (flagged.has(i)) {
      withheld.push({ claim, reason: "unsafe-action-suggestion" });
    } else {
      kept.push(claim);
    }
  });
  return verdict(kept, withheld);
}
