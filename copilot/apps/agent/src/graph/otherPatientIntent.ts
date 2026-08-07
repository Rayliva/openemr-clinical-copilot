/**
 * Pure detector: does the physician's message ask about a DIFFERENT / other patient than the one
 * whose chart is bound to this session? The agent operates on exactly one pid per session
 * (`authorization-and-pid-scope`), so a request naming another patient (by id/number, or "another
 * patient") short-circuits to a clear refusal that states the MISMATCH — the requested identifier
 * and the bound patient — rather than degrading to the generic "I don't have that here" (which
 * reads as "I couldn't find it", not "wrong patient") and rather than silently answering from the
 * bound chart (adversarial finding `live-2026-07-22T00-59-05-022Z-F1`: "labs for patient ID 123456"
 * returned the bound patient's labs with no mention that 123456 was not that patient).
 *
 * Deterministic + total, unit-tested — mirrors `writeIntent.ts`. Keys on unambiguous cross-patient
 * signals only (a record identifier — patient/pid/MRN/chart number — or "another/other/different
 * patient"); it does NOT try to recognize arbitrary other-patient NAMES (unreliable — a name in the
 * message is as likely to be a family member or a prescriber, so those fall through to the normal
 * grounded path, which finds no matching facts and degrades honestly). Numbers are guarded against
 * time / dose phrasings ("patient 3 months ago", "patient 3 mg") so a normal question does not
 * misfire, and a bare number with no identifier keyword is never treated as a patient reference.
 * An explicit identifier keyword (`ID`/`MRN`/…) followed by a value is a cross-patient signal
 * wherever it appears — it need not be adjacent to "patient" (Increment E).
 *
 * `docs/specs/auth-bridge-pid-scope.md` Increments C–E.
 */

/** A cross-patient request, with the identifier the physician asked about when one was given. */
export interface OtherPatientRequest {
  /** The requested record identifier (e.g. "123456"), or null for unnumbered phrasings. */
  readonly requestedRef: string | null;
}

/**
 * Trailing units/nouns that turn a digit into a duration, a dose, or a measurement rather than a
 * record identifier — "patient 3 months ago", "patient 3 mg", "65-year-old", "7 out of 10". The
 * separator allows a hyphen so the compound-adjective form ("65-year-old") is excluded too.
 */
const NOT_AN_IDENTIFIER = String.raw`(?![\s-]*(?:month|week|day|year|hour|minute|mg|ml|mcg|units?|%|out of))`;

/** An identifier must contain at least one digit — "medical record for allergies" is not one. */
const HAS_A_DIGIT = String.raw`(?=[A-Za-z0-9-]*\d)`;

/**
 * What may sit between an explicit identifier keyword and its value: "patient ID **is** 1234567890",
 * "identifier = 4421", "number: 77". Allowed ONLY after a keyword — a copula on its own would turn
 * "the patient is 58" into a patient id (finding `orch-2026-07-24T00-49-18-139Z-2-data-exfiltration-F1`
 * closed the keyword gap; this keeps it from over-closing).
 */
const ID_COPULA = String.raw`\s*(?:is|=|:|#|-)?\s*`;

/** Optional possessive on the noun — "the patient's ID is 999". */
const POSSESSIVE = String.raw`(?:'s|’s)?`;

/**
 * Patterns that reference a patient by an explicit record identifier. Each captures the identifier
 * so the refusal can echo exactly what was asked for.
 */
const IDENTIFIED_PATIENT_PATTERNS: readonly RegExp[] = [
  // With an EXPLICIT id keyword, a copula may introduce the value: "patient ID is 1234567890",
  // "the patient's identifier = 4421", "patient number: 77", "pt no. 7".
  new RegExp(
    String.raw`\b(?:patient|pt|subject)` +
      POSSESSIVE +
      String.raw`[\s_-]*(?:id(?:entifier)?|number|num|no\.?|#)` +
      ID_COPULA +
      String.raw`(\d+)\b` +
      NOT_AN_IDENTIFIER,
    "i",
  ),
  // Without a keyword, the number must follow the noun directly: "patient 3", "patient #3".
  // No copula here — "the patient is 58" is a sentence about the bound patient, not an id.
  new RegExp(String.raw`\b(?:patient|pt)[\s_-]*#?\s*(\d+)\b` + NOT_AN_IDENTIFIER, "i"),
  // "pid 3", "pid #2", "pid=2", "pid is 3"
  new RegExp(String.raw`\bpid` + ID_COPULA + String.raw`(\d+)\b`, "i"),
  // "MRN 998812", "mrn: A-4410", "medical record number 44120", "medical record #77".
  // The identifier must contain a digit, so "check her medical record for allergies" is not a match.
  new RegExp(
    String.raw`\b(?:mrn|medical\s+record(?:\s+(?:number|num|no\.?|#))?)` +
      ID_COPULA +
      HAS_A_DIGIT +
      String.raw`([A-Za-z0-9][A-Za-z0-9-]*)\b` +
      NOT_AN_IDENTIFIER,
    "i",
  ),
  // "chart 77", "chart number 77", "chart #77", "chart number is 77" — a chart referenced by id.
  new RegExp(String.raw`\bchart\s*(?:number|num|no\.?|#)?` + ID_COPULA + String.raw`(\d+)\b` + NOT_AN_IDENTIFIER, "i"),
  // An explicit identifier KEYWORD + value, wherever it sits — the keyword need not be adjacent to
  // "patient". Closes every filler-word variant in one rule: "the patient WITH ID 123456789",
  // "patient whose ID is 123", "(ID 123456789)", "record ID: 5" (finding
  // `orch-2026-07-24T00-49-18-139Z-1-tool-misuse-F2`). `\bid\b` is word-bounded so it never matches
  // inside "covid"/"valid"/"thyroid", and HAS_A_DIGIT keeps "ID badge" (no number) out.
  new RegExp(
    String.raw`\b(?:identifier|id|mrn)\b` +
      ID_COPULA +
      HAS_A_DIGIT +
      String.raw`([A-Za-z0-9][A-Za-z0-9-]*)\b` +
      NOT_AN_IDENTIFIER,
    "i",
  ),
];

/** Patterns that reference another patient without naming an identifier to echo. */
const UNIDENTIFIED_PATIENT_PATTERNS: readonly RegExp[] = [
  // "another patient", "a different patient", "some other chart", "a second patient", "other person"
  /\b(another|a\s+different|some\s+other|a\s+second|the\s+other|other)\s+(patient|chart|record|person)\b/i,
  // "someone else's chart / meds"
  /\bsomeone\s+else'?s?\b/i,
  // "a different / other patient's ..."
  /\b(different|other)\s+patient'?s\b/i,
];

/**
 * Detect a request about a patient other than the bound one. Returns the matched identifier when
 * the message gave one, `{ requestedRef: null }` for the unnumbered phrasings, and `null` when the
 * turn is in scope.
 */
export function detectOtherPatientRequest(message: string): OtherPatientRequest | null {
  for (const re of IDENTIFIED_PATIENT_PATTERNS) {
    const match = re.exec(message);
    if (match?.[1] !== undefined) {
      return { requestedRef: match[1] };
    }
  }
  if (UNIDENTIFIED_PATIENT_PATTERNS.some((re) => re.test(message))) {
    return { requestedRef: null };
  }
  return null;
}

/** True when the message asks about a patient other than the one bound to this session. */
export function isOtherPatientRequest(message: string): boolean {
  return detectOtherPatientRequest(message) !== null;
}
