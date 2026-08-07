import { z } from "zod";
import { mapFhirAllergies, type AllergyResult } from "@copilot/snapshot";
import type { FhirReader } from "./getPatientDemographics.js";

/**
 * Tool input contract (source of truth for the JSON Schema). The pid is bound from
 * the verified session by the caller — never chosen by the model
 * (authorization-and-pid-scope).
 */
export const GetAllergiesInput = z.object({
  patientId: z.string().min(1).describe("The FHIR id of the patient in context."),
});
export type GetAllergiesInput = z.infer<typeof GetAllergiesInput>;

/**
 * Result: the absence-aware allergy list. `documented:false` means *no allergy
 * record exists* — the agent must treat this as unknown, never "no allergies /
 * safe" (UC-4; AUDIT.md §4.5; provenance-and-grounding).
 */
export type GetAllergiesResult = AllergyResult;

export interface GetAllergiesDeps {
  readonly fhir: FhirReader;
  /** Injectable clock (testability); stamps provenance.fetchedAt. */
  readonly clock?: () => Date;
}

/**
 * Build the `getAllergies` tool: read FHIR AllergyIntolerance for the bound patient
 * and map to a documented/absent result. Absence is explicit so the agent never
 * implies the patient is allergy-free.
 */
export function createGetAllergies(deps: GetAllergiesDeps) {
  const clock = deps.clock ?? (() => new Date());

  return async function getAllergies(input: GetAllergiesInput): Promise<GetAllergiesResult> {
    const { patientId } = GetAllergiesInput.parse(input);
    const bundle = await deps.fhir.search("AllergyIntolerance", { patient: patientId });
    return mapFhirAllergies(bundle, clock());
  };
}
