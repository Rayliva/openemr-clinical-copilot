import { z } from "zod";
import { mapAndReconcileMedications, type MedicationResult } from "@copilot/snapshot";
import type { FhirReader } from "./getPatientDemographics.js";

/**
 * Tool input contract (source of truth for the JSON Schema). The pid is bound from
 * the verified session by the caller — never chosen by the model
 * (authorization-and-pid-scope).
 */
export const GetMedicationsInput = z.object({
  patientId: z.string().min(1).describe("The FHIR id of the patient in context."),
});
export type GetMedicationsInput = z.infer<typeof GetMedicationsInput>;

/** Result: the reconciled, absence-aware medication list (see `MedicationResult`). */
export type GetMedicationsResult = MedicationResult;

export interface GetMedicationsDeps {
  readonly fhir: FhirReader;
  /** Injectable clock (testability); stamps provenance.fetchedAt. */
  readonly clock?: () => Date;
}

/**
 * Build the `getMedications` tool: read FHIR MedicationRequest (which unions the
 * `lists` and `prescriptions` tables via `intent`) and reconcile into one list with
 * conflicts surfaced (UC-3). Returns `{documented:false}` when no record exists.
 */
export function createGetMedications(deps: GetMedicationsDeps) {
  const clock = deps.clock ?? (() => new Date());

  return async function getMedications(input: GetMedicationsInput): Promise<GetMedicationsResult> {
    const { patientId } = GetMedicationsInput.parse(input);
    const bundle = await deps.fhir.search("MedicationRequest", { patient: patientId });
    return mapAndReconcileMedications(bundle, clock());
  };
}
