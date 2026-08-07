import { describe, it, expect } from "vitest";
import { critique, applyLlmVeto, type Claim } from "../src/index.js";

/** A cited claim with the given statement — the common case (layer-1 already passed). */
const cited = (statement: string): Claim => ({ statement, sourceRefs: ["row-1"] });

describe("critique — verification layer 4 (the critic gate)", () => {
  describe("AC2: reporting a therapy is KEPT (the agent may report, not direct)", () => {
    const reports: readonly string[] = [
      "Her ferritin is 11 ng/mL (low) and hemoglobin 11.4 g/dL (low).",
      "The ADA guideline recommends a statin for diabetics over 40.",
      "Lisinopril was discontinued in 2014 per the lists table.",
      "No preventive migraine medication is documented.",
      "Propranolol 40 mg twice daily is on file.",
      "Metformin 1000 mg twice daily.",
      "She is due for an A1c — none is on file.",
      "Sumatriptan 50 mg as needed is listed on the intake form.",
      // History / report forms that begin with a subject or a past-tense verb — must stay KEPT even
      // though they mention start/stop/add (guards the new statement-initial imperative pattern).
      "She was started on lisinopril 10 mg in 2014.",
      "Started on metformin 500 mg in 2018, later discontinued.",
      "Stopped taking amitriptyline in 2016 per the note.",
      "An increase in creatinine since 2014 is documented.",
      "Amlodipine 5 mg is added to the reconciled list from the pharmacy printout.",
    ];
    it.each(reports)("keeps: %s", (statement) => {
      const v = critique([cited(statement)]);
      expect(v.keptClaims).toHaveLength(1);
      expect(v.withheldClaims).toHaveLength(0);
      expect(v.ok).toBe(true);
    });
  });

  describe("AC1: an agent-authored action suggestion is WITHHELD", () => {
    const unsafe: readonly string[] = [
      "Start her on ferrous sulfate 325 mg.",
      "I recommend starting a statin such as atorvastatin 20 mg.",
      "You should increase the propranolol dose to 80 mg twice daily.",
      "Consider starting a preventive such as topiramate.",
      "Switch her from the oral contraceptive to a progestin-only pill.",
      "Prescribe amoxicillin for the infection.",
      "Titrate the dose up to 40 mg.",
      "We advise initiating iron supplementation.",
      "Order a ferritin and start iron replacement.",
      // Bare-drug directives the earlier closed-follower patterns missed (the H1 finding).
      "Start metformin 500 mg twice daily.",
      "Add lisinopril 10 mg daily.",
      "Stop the lisinopril.",
      "Discontinue the amitriptyline.",
      "Give ferrous sulfate 325 mg.",
      "Order CBC and BMP.",
      "Switch lisinopril for losartan.",
      "Increase lisinopril to 20 mg daily.",
    ];
    it.each(unsafe)("withholds: %s", (statement) => {
      const v = critique([cited(statement)]);
      expect(v.keptClaims).toHaveLength(0);
      expect(v.withheldClaims).toHaveLength(1);
      expect(v.withheldClaims[0]!.reason).toBe("unsafe-action-suggestion");
      expect(v.ok).toBe(false);
    });
  });

  it("AC3: an uncited claim is withheld with reason 'uncited'", () => {
    const v = critique([{ statement: "Her hemoglobin is low.", sourceRefs: [] }]);
    expect(v.keptClaims).toHaveLength(0);
    expect(v.withheldClaims[0]!.reason).toBe("uncited");
  });

  it("partitions a mixed batch, preserving order of kept claims", () => {
    const v = critique([
      cited("Ferritin 11 ng/mL (low)."),
      cited("Start her on ferrous sulfate 325 mg."),
      cited("Hemoglobin 11.4 g/dL (low)."),
    ]);
    expect(v.keptClaims.map((c) => c.statement)).toEqual([
      "Ferritin 11 ng/mL (low).",
      "Hemoglobin 11.4 g/dL (low).",
    ]);
    expect(v.withheldClaims).toHaveLength(1);
  });

  it("an empty batch is ok with nothing withheld", () => {
    const v = critique([]);
    expect(v.ok).toBe(true);
    expect(v.keptClaims).toHaveLength(0);
    expect(v.withheldClaims).toHaveLength(0);
  });
});

describe("applyLlmVeto — the veto-only LLM critic fold (AC6)", () => {
  const kept: readonly Claim[] = [cited("Ferritin 11 ng/mL (low)."), cited("Hemoglobin 11.4 g/dL (low).")];

  it("removes exactly the claims the LLM flags (by index), leaving the rest", () => {
    const out = applyLlmVeto(kept, [1]);
    expect(out.keptClaims.map((c) => c.statement)).toEqual(["Ferritin 11 ng/mL (low)."]);
    expect(out.withheldClaims).toHaveLength(1);
    expect(out.withheldClaims[0]!.reason).toBe("unsafe-action-suggestion");
  });

  it("is a no-op when the LLM flags nothing (can only tighten)", () => {
    const out = applyLlmVeto(kept, []);
    expect(out.keptClaims).toHaveLength(2);
    expect(out.withheldClaims).toHaveLength(0);
  });

  it("ignores out-of-range indexes rather than throwing (never crashes the turn)", () => {
    const out = applyLlmVeto(kept, [5, -1]);
    expect(out.keptClaims).toHaveLength(2);
  });
});
