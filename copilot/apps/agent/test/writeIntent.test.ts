import { describe, it, expect } from "vitest";
import { isWriteRequest } from "../src/graph/writeIntent.js";

describe("isWriteRequest — detect a request to change chart state", () => {
  describe("WRITE requests (must return true)", () => {
    const writes: readonly string[] = [
      "Update Grace's glucose level to 1000.",
      "update the chart",
      "Please update her chart with the new value.",
      "Change her problem status to resolved.",
      "Set her A1c to 6.5 in the record.",
      "Add this lab result to the chart.",
      "Record it in her chart.",
      "Enter a new allergy into the record.",
      "Delete the lisinopril from the chart.",
      "Remove that problem from her record.",
      "Mark her hypertension as resolved.",
      "Create a new order for a CBC.",
      "Start a new note for this visit.",
    ];
    it.each(writes)("true: %s", (m) => expect(isWriteRequest(m)).toBe(true));
  });

  describe("READ requests (must return false — no false-positive refusals)", () => {
    const reads: readonly string[] = [
      "Give me an update on Grace.",
      "Update me on her chart.",
      "What changed since her last visit?",
      "Compare her glucose to the reference range.",
      "What should I confirm before renewing her meds?",
      "What medications is she on?",
      "Summarize her chart.",
      "Is she due for anything?",
      "According to the guideline, what's her A1c target?",
      "What allergies are documented?",
    ];
    it.each(reads)("false: %s", (m) => expect(isWriteRequest(m)).toBe(false));
  });
});
