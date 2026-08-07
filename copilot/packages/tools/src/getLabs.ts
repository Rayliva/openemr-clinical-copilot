import { z } from "zod";
import { mapAndCollectObservations, type ObservationResult } from "@copilot/snapshot";
import type { FhirReader } from "./getPatientDemographics.js";

/**
 * Tool input contract. The pid is bound from the verified session by the caller — never
 * chosen by the model (authorization-and-pid-scope).
 */
export const GetLabsInput = z.object({
  patientId: z.string().min(1).describe("The FHIR id of the patient in context."),
});
export type GetLabsInput = z.infer<typeof GetLabsInput>;

/**
 * Result: the absence-aware latest lab results. `documented:false` means *no lab results on
 * file* — reported as "none documented," never as "normal" (provenance-and-grounding). A
 * missing lab is not a normal lab.
 */
export type GetLabsResult = ObservationResult;

export interface GetLabsDeps {
  readonly fhir: FhirReader;
  /** Injectable clock (testability); stamps provenance.fetchedAt. */
  readonly clock?: () => Date;
}

/**
 * Build the `getLabs` tool: read FHIR Observation (category laboratory) for the bound patient
 * and collapse to the most-recent result per type (A1c, lipids, eGFR, …), provenance-tagged
 * and absence-aware.
 */
export function createGetLabs(deps: GetLabsDeps) {
  const clock = deps.clock ?? (() => new Date());

  return async function getLabs(input: GetLabsInput): Promise<GetLabsResult> {
    const { patientId } = GetLabsInput.parse(input);
    const bundle = await deps.fhir.search("Observation", { patient: patientId, category: "laboratory" });
    return mapAndCollectObservations(bundle, "procedure_result", clock());
  };
}
