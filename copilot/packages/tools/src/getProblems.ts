import { z } from "zod";
import { mapFhirConditions, type Problem } from "@copilot/snapshot";
import type { FhirReader } from "./getPatientDemographics.js";

/**
 * Tool input contract (source of truth for the JSON Schema). The pid is bound from
 * the verified session by the caller — never chosen by the model
 * (authorization-and-pid-scope).
 */
export const GetProblemsInput = z.object({
  patientId: z.string().min(1).describe("The FHIR id of the patient in context."),
});
export type GetProblemsInput = z.infer<typeof GetProblemsInput>;

/**
 * Result: the absence-aware problem list. `documented:false` means *no problem
 * record exists* — the agent must report "none documented," never imply the patient
 * is healthy / problem-free (provenance-and-grounding: absence ≠ negative finding).
 */
export type GetProblemsResult =
  | { readonly documented: true; readonly problems: readonly Problem[] }
  | { readonly documented: false };

export interface GetProblemsDeps {
  readonly fhir: FhirReader;
  /** Injectable clock (testability); stamps provenance.fetchedAt. */
  readonly clock?: () => Date;
}

/**
 * Build the `getProblems` tool: read FHIR Condition for the bound patient and map to
 * a provenance-tagged, absence-aware problem list (the active/inactive clinical
 * status is preserved so the agent can distinguish current from resolved problems).
 */
export function createGetProblems(deps: GetProblemsDeps) {
  const clock = deps.clock ?? (() => new Date());

  return async function getProblems(input: GetProblemsInput): Promise<GetProblemsResult> {
    const { patientId } = GetProblemsInput.parse(input);
    const bundle = await deps.fhir.search("Condition", { patient: patientId });
    const problems = mapFhirConditions(bundle, clock());
    if (problems.length === 0) {
      return { documented: false };
    }
    return { documented: true, problems };
  };
}
