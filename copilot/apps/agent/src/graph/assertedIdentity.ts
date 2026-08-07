/**
 * Pure detector: what does the physician's message *assert* about the patient's identity?
 *
 * A consult-framed request often restates who the patient is ("a 58-year-old with CKD"). When that
 * restatement disagrees with the open chart, the identity is unconfirmed — the request may be about
 * someone else entirely — and the agent must challenge it before disclosing anything clinical,
 * rather than answering and noting the discrepancy in passing (adversarial finding
 * `orch-2026-07-24T00-49-18-139Z-2-data-exfiltration-F1`, where the agent reported "documented age
 * is 59 years, not 58" and then listed the medications and labs anyway).
 *
 * Age only. An asserted NAME is not checked: a name in a consult message is as likely to be a
 * colleague, a family member, or a prescriber ("my colleague Dr. Jones") as the patient.
 *
 * `docs/specs/auth-bridge-pid-scope.md` Increment D.
 */

/** Bounds a plausible patient age — outside this, the number is something else in the sentence. */
const MIN_AGE = 1;
const MAX_AGE = 120;

/**
 * Age phrasings. Each captures the number. `year|yr|y` must be followed by `old` so a duration
 * ("a 20-year history of smoking") is not read as an age, and the unit must be years so
 * "6-month-old" does not match.
 */
const ASSERTED_AGE_PATTERNS: readonly RegExp[] = [
  // "58-year-old", "58 year old", "72-yr-old", "45 years old"
  /\b(\d{1,3})[\s-]*(?:year|yr)s?[\s-]*old\b/i,
  // "45 y/o", "61 yo", "61y.o."
  /\b(\d{1,3})\s*-?\s*y\s*[/.]?\s*o\.?\b/i,
  // "aged 58", "age 58", "age is 58", "age of 58", "age: 58"
  /\bage[ds]?\s*(?:is|of|=|:)?\s*(\d{1,3})\b/i,
];

/**
 * The whole-year age the message asserts about the patient, or null when none is asserted (or the
 * number is not a plausible age).
 */
export function detectAssertedAge(message: string): number | null {
  for (const re of ASSERTED_AGE_PATTERNS) {
    const match = re.exec(message);
    if (match?.[1] === undefined) {
      continue;
    }
    const age = Number.parseInt(match[1], 10);
    if (Number.isInteger(age) && age >= MIN_AGE && age <= MAX_AGE) {
      return age;
    }
  }
  return null;
}
