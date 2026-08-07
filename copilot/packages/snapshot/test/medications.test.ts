import { describe, it, expect } from "vitest";
import {
  mapFhirMedicationRequest,
  mapFhirMedications,
  reconcileMeds,
  mapAndReconcileMedications,
  type MedicationSource,
} from "../src/medications.js";

const FETCHED = new Date("2026-07-08T12:00:00Z");

/** Susan Underwood's real MedicationRequest bundle (trimmed to mapped fields). */
const SUSAN_BUNDLE = {
  resourceType: "Bundle",
  type: "collection",
  entry: [
    {
      resource: {
        resourceType: "MedicationRequest",
        id: "rx-lisinopril",
        status: "active",
        intent: "order",
        medicationCodeableConcept: { text: "Lisinopril" },
      },
    },
    {
      resource: {
        resourceType: "MedicationRequest",
        id: "list-metformin",
        status: "active",
        intent: "plan",
        medicationCodeableConcept: { text: "Metformin" },
      },
    },
    {
      resource: {
        resourceType: "MedicationRequest",
        id: "list-lipitor",
        status: "active",
        intent: "plan",
        medicationCodeableConcept: { text: "Lipitor" },
      },
    },
    {
      resource: {
        resourceType: "MedicationRequest",
        id: "list-lisinopril",
        status: "stopped",
        intent: "plan",
        medicationCodeableConcept: { text: "Lisinopril" },
      },
    },
  ],
};

describe("mapFhirMedicationRequest", () => {
  it("derives sourceTable prescriptions from intent:order", () => {
    const src = mapFhirMedicationRequest(SUSAN_BUNDLE.entry[0]!.resource, FETCHED);
    expect(src).toMatchObject({ drug: "Lisinopril", status: "active", active: true });
    expect(src.provenance).toEqual({
      sourceTable: "prescriptions",
      rowUuid: "rx-lisinopril",
      fetchedAt: "2026-07-08T12:00:00.000Z",
    });
  });

  it("derives sourceTable lists from intent:plan and marks stopped as inactive", () => {
    const src = mapFhirMedicationRequest(SUSAN_BUNDLE.entry[3]!.resource, FETCHED);
    expect(src).toMatchObject({ drug: "Lisinopril", status: "stopped", active: false });
    expect(src.provenance.sourceTable).toBe("lists");
  });

  it("extracts SIG text, dose quantity, and route from dosageInstruction", () => {
    const src = mapFhirMedicationRequest(
      {
        resourceType: "MedicationRequest",
        id: "rx-albuterol",
        status: "active",
        intent: "order",
        medicationCodeableConcept: { text: "Albuterol" },
        dosageInstruction: [
          {
            text: "2 puffs every 4 hours as needed",
            route: { coding: [{ display: "Inhalation" }] },
            doseAndRate: [{ doseQuantity: { value: 90, unit: "mcg" } }],
          },
        ],
      },
      FETCHED,
    );
    expect(src.dosage).toEqual({ text: "2 puffs every 4 hours as needed", dose: "90 mcg", route: "Inhalation" });
  });

  it("maps a value-only doseQuantity without a unit, and prefers route.text", () => {
    const src = mapFhirMedicationRequest(
      {
        resourceType: "MedicationRequest",
        id: "rx-x",
        status: "active",
        intent: "order",
        medicationCodeableConcept: { text: "Foo" },
        dosageInstruction: [{ route: { text: "Oral" }, doseAndRate: [{ doseQuantity: { value: 10 } }] }],
      },
      FETCHED,
    );
    expect(src.dosage).toEqual({ dose: "10", route: "Oral" });
  });

  it("leaves dosage absent when dosageInstruction is missing or empty", () => {
    const noInstr = mapFhirMedicationRequest(SUSAN_BUNDLE.entry[0]!.resource, FETCHED);
    expect(noInstr.dosage).toBeUndefined();
    const emptyInstr = mapFhirMedicationRequest(
      {
        resourceType: "MedicationRequest",
        id: "rx-y",
        status: "active",
        intent: "order",
        medicationCodeableConcept: { text: "Bar" },
        dosageInstruction: [{}],
      },
      FETCHED,
    );
    expect(emptyInstr.dosage).toBeUndefined();
  });

  it("carries dosage through reconciliation onto the med's sources", () => {
    const bundle = {
      resourceType: "Bundle",
      entry: [
        {
          resource: {
            resourceType: "MedicationRequest",
            id: "rx-albuterol",
            status: "active",
            intent: "order",
            medicationCodeableConcept: { text: "Albuterol" },
            dosageInstruction: [{ text: "2 puffs QID" }],
          },
        },
      ],
    };
    const [med] = reconcileMeds(mapFhirMedications(bundle, FETCHED));
    expect(med!.sources[0]!.dosage).toEqual({ text: "2 puffs QID" });
  });

  it("extracts authoredOn (the prescription date OpenEMR shows) when present", () => {
    const src = mapFhirMedicationRequest(
      {
        resourceType: "MedicationRequest",
        id: "rx-suma",
        status: "active",
        intent: "order",
        medicationCodeableConcept: { text: "Sumatriptan" },
        authoredOn: "2026-05-12",
      },
      FETCHED,
    );
    expect(src.authoredOn).toBe("2026-05-12");
  });

  it("leaves authoredOn absent when the resource has none", () => {
    const src = mapFhirMedicationRequest(SUSAN_BUNDLE.entry[1]!.resource, FETCHED);
    expect(src.authoredOn).toBeUndefined();
  });

  it("carries authoredOn through reconciliation onto the med's sources", () => {
    const bundle = {
      resourceType: "Bundle",
      entry: [
        {
          resource: {
            resourceType: "MedicationRequest",
            id: "rx-suma",
            status: "active",
            intent: "order",
            medicationCodeableConcept: { text: "Sumatriptan" },
            authoredOn: "2026-05-12",
          },
        },
      ],
    };
    const [med] = reconcileMeds(mapFhirMedications(bundle, FETCHED));
    expect(med!.sources[0]!.authoredOn).toBe("2026-05-12");
  });

  it("throws SnapshotMappingError on unknown/missing intent", () => {
    expect(() =>
      mapFhirMedicationRequest(
        { resourceType: "MedicationRequest", id: "x", status: "active", medicationCodeableConcept: { text: "Foo" } },
        FETCHED,
      ),
    ).toThrow();
  });

  it("throws on a non-MedicationRequest resource", () => {
    expect(() =>
      mapFhirMedicationRequest({ resourceType: "Condition", id: "c" }, FETCHED),
    ).toThrow();
  });

  it("skips one unmappable resource instead of discarding the whole list", () => {
    // Resilience: one bad row (unknown intent) must not lose every other medication.
    const bundle = {
      resourceType: "Bundle",
      entry: [
        {
          resource: {
            resourceType: "MedicationRequest",
            id: "rx-good",
            status: "active",
            intent: "order",
            medicationCodeableConcept: { text: "Lisinopril" },
          },
        },
        {
          resource: {
            resourceType: "MedicationRequest",
            id: "rx-bad",
            status: "active",
            medicationCodeableConcept: { text: "Mystery" }, // no intent → unmappable
          },
        },
      ],
    };
    const sources = mapFhirMedications(bundle, FETCHED);
    expect(sources.map((s) => s.drug)).toEqual(["Lisinopril"]);
  });
});

describe("reconcileMeds", () => {
  it("reconciles Susan's 4 entries into 3 meds, flagging the Lisinopril conflict", () => {
    const sources = mapFhirMedications(SUSAN_BUNDLE, FETCHED);
    const reconciled = reconcileMeds(sources);

    expect(reconciled.map((m) => m.drug)).toEqual(["Lipitor", "Lisinopril", "Metformin"]);

    const lisinopril = reconciled.find((m) => m.drug === "Lisinopril")!;
    expect(lisinopril.status).toBe("conflicted");
    expect(lisinopril.hasConflict).toBe(true);
    // both sources cited, so the conflict claim can reference each row
    const tables = lisinopril.provenance.map((p) => p.sourceTable).sort();
    expect(tables).toEqual(["lists", "prescriptions"]);
    expect(lisinopril.provenance).toHaveLength(2);
  });

  it("reconciles single-source active meds without conflict", () => {
    const reconciled = reconcileMeds(mapFhirMedications(SUSAN_BUNDLE, FETCHED));
    const metformin = reconciled.find((m) => m.drug === "Metformin")!;
    expect(metformin.status).toBe("active");
    expect(metformin.hasConflict).toBe(false);
    expect(metformin.provenance).toHaveLength(1);
  });

  it("does not flag a conflict when both sources agree (both active)", () => {
    const both: MedicationSource[] = [
      { drug: "Aspirin", sourceTable: "prescriptions", status: "active", active: true, provenance: { sourceTable: "prescriptions", rowUuid: "a", fetchedAt: FETCHED.toISOString() } },
      { drug: "aspirin", sourceTable: "lists", status: "active", active: true, provenance: { sourceTable: "lists", rowUuid: "b", fetchedAt: FETCHED.toISOString() } },
    ];
    const [med] = reconcileMeds(both);
    expect(med!.status).toBe("active");
    expect(med!.hasConflict).toBe(false);
    expect(med!.provenance).toHaveLength(2);
  });

  it("reconciles both-inactive to inactive without conflict", () => {
    const both: MedicationSource[] = [
      { drug: "Omeprazole", sourceTable: "prescriptions", status: "stopped", active: false, provenance: { sourceTable: "prescriptions", rowUuid: "a", fetchedAt: FETCHED.toISOString() } },
      { drug: "omeprazole", sourceTable: "lists", status: "completed", active: false, provenance: { sourceTable: "lists", rowUuid: "b", fetchedAt: FETCHED.toISOString() } },
    ];
    const [med] = reconcileMeds(both);
    expect(med!.status).toBe("inactive");
    expect(med!.hasConflict).toBe(false);
  });

  it("is order-independent (sorted by normalized name)", () => {
    const sources = mapFhirMedications(SUSAN_BUNDLE, FETCHED);
    const forward = reconcileMeds(sources).map((m) => m.drug);
    const reversed = reconcileMeds([...sources].reverse()).map((m) => m.drug);
    expect(reversed).toEqual(forward);
  });
});

describe("mapAndReconcileMedications (absence-aware)", () => {
  it("returns documented:true with reconciled meds for a non-empty bundle", () => {
    const res = mapAndReconcileMedications(SUSAN_BUNDLE, FETCHED);
    expect(res.documented).toBe(true);
    if (res.documented) {
      expect(res.medications).toHaveLength(3);
    }
  });

  it("returns documented:false for an empty bundle (absence, not 'no meds')", () => {
    expect(mapAndReconcileMedications({ resourceType: "Bundle", entry: [] }, FETCHED)).toEqual({
      documented: false,
    });
  });
});
