import { z } from "zod";
import { mapFhirImmunizations, type Immunization } from "@copilot/snapshot";
import type { FhirReader } from "./getPatientDemographics.js";

/**
 * Tool input contract (source of truth for the JSON Schema). The pid is bound from
 * the verified session by the caller — never chosen by the model
 * (authorization-and-pid-scope).
 */
export const GetImmunizationsInput = z.object({
  patientId: z.string().min(1).describe("The FHIR id of the patient in context."),
});
export type GetImmunizationsInput = z.infer<typeof GetImmunizationsInput>;

/**
 * Result: the absence-aware immunization list. `documented:false` means *no
 * immunization record exists* — the agent must report "none on file," never imply the
 * patient is up to date or unvaccinated (provenance-and-grounding: absence ≠ finding).
 * NB: this surfaces the vaccines ON FILE; it does not compute which are *missing*
 * (that needs a recommended-schedule reference we do not fabricate).
 */
export type GetImmunizationsResult =
  | { readonly documented: true; readonly immunizations: readonly Immunization[] }
  | { readonly documented: false };

export interface GetImmunizationsDeps {
  readonly fhir: FhirReader;
  /** Injectable clock (testability); stamps provenance.fetchedAt. */
  readonly clock?: () => Date;
}

/** Build the `getImmunizations` tool: read FHIR Immunization for the bound patient. */
export function createGetImmunizations(deps: GetImmunizationsDeps) {
  const clock = deps.clock ?? (() => new Date());

  return async function getImmunizations(
    input: GetImmunizationsInput,
  ): Promise<GetImmunizationsResult> {
    const { patientId } = GetImmunizationsInput.parse(input);
    const bundle = await deps.fhir.search("Immunization", { patient: patientId });
    const immunizations = mapFhirImmunizations(bundle, clock());
    if (immunizations.length === 0) {
      return { documented: false };
    }
    return { documented: true, immunizations };
  };
}
