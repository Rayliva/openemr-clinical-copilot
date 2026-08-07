import { z } from "zod";
import { mapAndCollectObservations, type ObservationResult } from "@copilot/snapshot";
import type { FhirReader } from "./getPatientDemographics.js";

/**
 * Tool input contract. The pid is bound from the verified session by the caller — never
 * chosen by the model (authorization-and-pid-scope).
 */
export const GetVitalsInput = z.object({
  patientId: z.string().min(1).describe("The FHIR id of the patient in context."),
});
export type GetVitalsInput = z.infer<typeof GetVitalsInput>;

/**
 * Result: the absence-aware latest vitals. `documented:false` means *no vital-signs on file*
 * — reported as "none documented," never as "normal" (provenance-and-grounding).
 */
export type GetVitalsResult = ObservationResult;

export interface GetVitalsDeps {
  readonly fhir: FhirReader;
  /** Injectable clock (testability); stamps provenance.fetchedAt. */
  readonly clock?: () => Date;
}

/**
 * Build the `getVitals` tool: read FHIR Observation (category vital-signs) for the bound
 * patient and collapse to the most-recent reading per type (BP, HR, weight, BMI, …),
 * provenance-tagged and absence-aware.
 */
export function createGetVitals(deps: GetVitalsDeps) {
  const clock = deps.clock ?? (() => new Date());

  return async function getVitals(input: GetVitalsInput): Promise<GetVitalsResult> {
    const { patientId } = GetVitalsInput.parse(input);
    const bundle = await deps.fhir.search("Observation", { patient: patientId, category: "vital-signs" });
    return mapAndCollectObservations(bundle, "form_vitals", clock());
  };
}
