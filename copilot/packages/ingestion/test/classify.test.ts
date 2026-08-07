import { describe, it, expect } from "vitest";
import { classifyDocType } from "../src/classify.js";
import type { PendingDocument } from "../src/detect.js";

function doc(title: string): PendingDocument {
  return { documentId: "d", binaryId: "b", contentType: "application/pdf", title };
}

describe("classifyDocType — title heuristic", () => {
  it("classifies an intake-form title as intake_form", () => {
    expect(classifyDocType(doc("Patient Intake Form"))).toBe("intake_form");
    expect(classifyDocType(doc("susan-intake-form.pdf"))).toBe("intake_form");
  });

  it("classifies registration / new-patient / bare 'form' titles as intake_form", () => {
    expect(classifyDocType(doc("New Patient Registration"))).toBe("intake_form");
    expect(classifyDocType(doc("New-Patient Questionnaire"))).toBe("intake_form");
    expect(classifyDocType(doc("Admission Form 2026"))).toBe("intake_form");
  });

  it("classifies a lab title as lab_pdf (the default)", () => {
    expect(classifyDocType(doc("Comprehensive Metabolic Panel"))).toBe("lab_pdf");
    expect(classifyDocType(doc("susan-lab-panel.pdf"))).toBe("lab_pdf");
    expect(classifyDocType(doc(""))).toBe("lab_pdf");
  });

  it("does not misfire on 'information' (substring 'form') — matches a whole 'form' word only", () => {
    expect(classifyDocType(doc("Patient Information Summary"))).toBe("lab_pdf");
  });

  it("classifies a medication-list / pharmacy title as medication_list", () => {
    expect(classifyDocType(doc("Medication List"))).toBe("medication_list");
    expect(classifyDocType(doc("bello-grace-medication-list.pdf"))).toBe("medication_list");
    expect(classifyDocType(doc("Pharmacy Printout"))).toBe("medication_list");
    expect(classifyDocType(doc("Current Medications"))).toBe("medication_list");
  });

  it("routes 'Medication Reconciliation Form' to medication_list, not intake (med-list checked first)", () => {
    // The title contains 'form' (would match intake) but the medication-list heuristic runs first.
    expect(classifyDocType(doc("Medication Reconciliation Form"))).toBe("medication_list");
  });

  it("classifies a referral / consult-request title as referral_fax (space or hyphen)", () => {
    expect(classifyDocType(doc("Cardiology Referral"))).toBe("referral_fax");
    expect(classifyDocType(doc("underwood-susan-referral-fax.pdf"))).toBe("referral_fax");
    expect(classifyDocType(doc("Consultation Request"))).toBe("referral_fax");
  });

  it("routes 'Referral Form' to referral_fax, not intake (referral checked before intake)", () => {
    // Contains 'form' (would match intake) but the referral heuristic runs first.
    expect(classifyDocType(doc("Specialist Referral Form"))).toBe("referral_fax");
  });

  it("does not reclassify existing med-list / intake / lab titles after adding referral", () => {
    expect(classifyDocType(doc("Medication List"))).toBe("medication_list");
    expect(classifyDocType(doc("Patient Intake Form"))).toBe("intake_form");
    expect(classifyDocType(doc("Comprehensive Metabolic Panel"))).toBe("lab_pdf");
  });
});
