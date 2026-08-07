import { z } from "zod";
import { bundleResources, mapFhirPatient, type PatientDemographics } from "@copilot/snapshot";

/**
 * Tool input contract (the source of truth). Its JSON Schema is derived from this
 * Zod schema for the LLM tool definition — never hand-written.
 */
export const GetPatientDemographicsInput = z.object({
  patientId: z.string().min(1).describe("The FHIR id of the patient in context."),
});
export type GetPatientDemographicsInput = z.infer<typeof GetPatientDemographicsInput>;

/**
 * Result. `found: false` is the explicit "no data on file" sentinel — distinct
 * from a negative finding (provenance-and-grounding rule).
 */
export type GetPatientDemographicsResult =
  | { readonly found: true; readonly demographics: PatientDemographics }
  | { readonly found: false };

/** The minimal FHIR reader the tool needs; the real OpenEmrFhirClient satisfies it. */
export interface FhirReader {
  search(resourceType: string, params: Record<string, string>): Promise<unknown>;
}

export interface GetPatientDemographicsDeps {
  readonly fhir: FhirReader;
  /** Injectable clock (testability); stamps provenance.fetchedAt. */
  readonly clock?: () => Date;
}

/**
 * Build the `getPatientDemographics` tool: read the patient by FHIR id and map to
 * provenance-tagged demographics. Returns `{found:false}` when no record exists.
 */
export function createGetPatientDemographics(deps: GetPatientDemographicsDeps) {
  const clock = deps.clock ?? (() => new Date());

  return async function getPatientDemographics(
    input: GetPatientDemographicsInput,
  ): Promise<GetPatientDemographicsResult> {
    const { patientId } = GetPatientDemographicsInput.parse(input);

    // Parse the searchset at the boundary (Zod, like every sibling tool) instead of an
    // `as` cast: a non-Bundle body (null / error envelope) becomes a typed
    // SnapshotMappingError the graph can handle, not an untyped TypeError.
    const resources = bundleResources(await deps.fhir.search("Patient", { _id: patientId }));
    const resource = resources[0];
    if (resource === undefined) {
      return { found: false };
    }

    return { found: true, demographics: mapFhirPatient(resource, clock()) };
  };
}
