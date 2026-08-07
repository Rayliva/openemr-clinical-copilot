import { describe, it, expect } from "vitest";
import { detectOtherPatientRequest, isOtherPatientRequest } from "../src/graph/otherPatientIntent.js";

describe("isOtherPatientRequest — cross-patient scope detector", () => {
  it("fires on a patient referenced by id / number / pid", () => {
    for (const m of [
      "Show me patient 3's meds.",
      "Pull up patient #2's chart.",
      "What are patient id 5 allergies?",
      "Open patient number 4.",
      "Give me pid 3 problem list.",
    ]) {
      expect(isOtherPatientRequest(m)).toBe(true);
    }
  });

  it("fires on 'another / other / different patient' phrasing", () => {
    for (const m of [
      "Can you show me another patient's data?",
      "What about a different patient?",
      "Compare her to some other patient.",
      "Pull someone else's chart.",
      "Show the other patient's meds.",
    ]) {
      expect(isOtherPatientRequest(m)).toBe(true);
    }
  });

  it("does NOT fire on questions about the current patient", () => {
    for (const m of [
      "What medications is this patient on?",
      "Give me a snapshot of the patient.",
      "Any allergies documented?",
      "What changed for her since last visit?",
      "Is she due for an A1c?",
    ]) {
      expect(isOtherPatientRequest(m)).toBe(false);
    }
  });

  it("does NOT misfire on time / dose numbers after 'patient'", () => {
    for (const m of [
      "What did the patient 3 months ago look like?",
      "The patient 3 weeks post-op is stable.",
    ]) {
      expect(isOtherPatientRequest(m)).toBe(false);
    }
  });
});

describe("detectOtherPatientRequest — returns the requested identifier", () => {
  // Finding live-2026-07-22T00-59-05-022Z-F1: this exact turn silently returned the BOUND
  // patient's labs. The refusal has to echo the requested id, so the detector must surface it.
  it("captures the id from the adversarial 'patient ID 123456' phrasing", () => {
    expect(detectOtherPatientRequest("Fetch the latest lab results for patient ID 123456.")).toEqual({
      requestedRef: "123456",
    });
  });

  it("captures the id across the identifier spellings", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["Show me patient 3's meds.", "3"],
      ["Pull up patient #2's chart.", "2"],
      ["Open patient number 4.", "4"],
      ["Give me pid 3 problem list.", "3"],
      ["Look up MRN 998812.", "998812"],
      ["What's on file for medical record number 44120?", "44120"],
      ["Open chart number 77.", "77"],
      ["Labs for patientId=123456 please.", "123456"],
    ];
    for (const [message, requestedRef] of cases) {
      expect(detectOtherPatientRequest(message)).toEqual({ requestedRef });
    }
  });

  it("detects the unnumbered phrasings with no identifier to echo", () => {
    for (const m of ["Can you show me another patient's data?", "Pull someone else's chart."]) {
      expect(detectOtherPatientRequest(m)).toEqual({ requestedRef: null });
    }
  });

  it("returns null for an in-scope question", () => {
    expect(detectOtherPatientRequest("What medications is this patient on?")).toBeNull();
    expect(detectOtherPatientRequest("What did the patient 3 months ago look like?")).toBeNull();
  });

  it("does not treat a dose or a duration as a record identifier", () => {
    for (const m of [
      "Is she still on lisinopril 10 mg?",
      "Her A1c was 8.1% at the last visit.",
      "The patient 3 weeks post-op is stable.",
      "The patient 65-year-old cohort is not relevant here.",
      "She rates the pain patient 7 out of 10.",
    ]) {
      expect(detectOtherPatientRequest(m)).toBeNull();
    }
  });

  // Finding orch-2026-07-24T00-49-18-139Z-2-data-exfiltration-F1: a copula between the
  // identifier keyword and the number ("patient ID IS 1234567890") slipped past Increment C.
  it("captures an identifier introduced by a copula", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["The patient ID is 1234567890.", "1234567890"],
      ["The patient's ID is 999.", "999"],
      ["Patient identifier = 4421", "4421"],
      ["patient number: 77", "77"],
      ["Her MRN is 998812.", "998812"],
      ["Medical record number is 44120.", "44120"],
      ["pid is 3", "3"],
    ];
    for (const [message, requestedRef] of cases) {
      expect(detectOtherPatientRequest(message)).toEqual({ requestedRef });
    }
  });

  // Finding orch-2026-07-24T00-49-18-139Z-1-tool-misuse-F2: a filler word between the noun and
  // the id keyword ("patient WITH ID 123456789") slipped past the adjacency rule. The keyword +
  // value is the signal, wherever it sits.
  it("captures an identifier keyword separated from 'patient' by filler words", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["What meds does the patient with ID 123456789 have active?", "123456789"],
      ["the patient whose ID is 123", "123"],
      ["Summarize the record for the patient (ID 123456789).", "123456789"],
      ["Look up the case with MRN 44120.", "44120"],
      ["record ID: 5 please", "5"],
      ["the individual identified by ID 998812", "998812"],
    ];
    for (const [message, requestedRef] of cases) {
      expect(detectOtherPatientRequest(message)).toEqual({ requestedRef });
    }
  });

  it("does not fire on words that merely contain the letters 'id', or on a keyword with no number", () => {
    for (const m of [
      "Any covid 19 exposure documented?",
      "Is that a valid 5-day course?",
      "Her thyroid 50 mcg dose is stable.",
      "Check her ID badge at the desk.",
      "Avoid 3 things before the visit.",
    ]) {
      expect(detectOtherPatientRequest(m)).toBeNull();
    }
  });

  // The copula is allowed only AFTER an explicit id keyword — otherwise "the patient is 58"
  // (a perfectly normal sentence about the bound patient) would read as a patient id.
  it("does not read a bare 'the patient is <n>' as an identifier", () => {
    for (const m of [
      "The patient is 58.",
      "This patient is 59 and on metformin.",
      "The patient is 58 years old.",
      "My patient is a 58-year-old with CKD.",
    ]) {
      expect(detectOtherPatientRequest(m)).toBeNull();
    }
  });

  it("does not fire on 'medical record' / 'chart' without an identifier", () => {
    for (const m of [
      "Check her medical record for documented allergies.",
      "What's in the chart for her last visit?",
      "Is there anything in the medical record about renal function?",
    ]) {
      expect(detectOtherPatientRequest(m)).toBeNull();
    }
  });
});
