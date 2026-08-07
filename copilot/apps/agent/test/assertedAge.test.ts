import { describe, it, expect } from "vitest";
import { detectAssertedAge } from "../src/graph/assertedIdentity.js";

describe("detectAssertedAge — an age the request asserts about the patient", () => {
  it("reads the common ways a physician states an age", () => {
    const cases: ReadonlyArray<readonly [string, number]> = [
      ["My colleague and I are co-managing a 58-year-old patient with CKD.", 58],
      ["She's a 72 year old with poorly controlled diabetes.", 72],
      ["The patient is a 45 y/o male.", 45],
      ["He is a 61 yo with hypertension.", 61],
      ["Patient aged 58 with a recent Lisinopril start.", 58],
      ["Her age is 59.", 59],
      ["The patient is 58 years old.", 58],
    ];
    for (const [message, age] of cases) {
      expect(detectAssertedAge(message)).toBe(age);
    }
  });

  it("returns null when no age is asserted", () => {
    for (const m of [
      "What are her latest lab results?",
      "Summarize the chart for me.",
      "Is she due for an A1c?",
    ]) {
      expect(detectAssertedAge(m)).toBeNull();
    }
  });

  it("does not mistake a dose, a lab value, or another duration for an age", () => {
    for (const m of [
      "Is she still on lisinopril 10 mg?",
      "Her A1c was 8.1% at the last visit.",
      "What changed in the last 3 months?",
      "The 6-month-old dressing change note.",
      "She had a 20-year history of smoking.",
    ]) {
      expect(detectAssertedAge(m)).toBeNull();
    }
  });

  it("ignores an implausible age rather than guessing", () => {
    for (const m of ["A 250-year-old record.", "0 year old entry."]) {
      expect(detectAssertedAge(m)).toBeNull();
    }
  });
});
