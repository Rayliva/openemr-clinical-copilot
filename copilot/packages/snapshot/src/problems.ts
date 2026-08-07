import { z } from "zod";
import { bundleResources } from "./bundle.js";
import { SnapshotMappingError } from "./errors.js";
import { provenanceOf, type Provenance } from "./provenance.js";

const CodingSchema = z.object({
  code: z.string().optional(),
  display: z.string().optional(),
});
const CodeableConceptSchema = z.object({
  text: z.string().optional(),
  coding: z.array(CodingSchema).optional(),
});
const ConditionSchema = z.object({
  resourceType: z.literal("Condition"),
  id: z.string().min(1),
  code: CodeableConceptSchema.optional(),
  clinicalStatus: z.object({ coding: z.array(CodingSchema).optional() }).optional(),
});

/** A provenance-tagged problem-list entry. */
export interface Problem {
  readonly display: string;
  readonly clinicalStatus?: string;
  readonly provenance: Provenance;
}

function displayOf(code: z.infer<typeof CodeableConceptSchema> | undefined): string | undefined {
  if (code === undefined) {
    return undefined;
  }
  if (code.text !== undefined && code.text.length > 0) {
    return code.text;
  }
  return code.coding?.find((c) => c.display !== undefined && c.display.length > 0)?.display;
}

/** Map a FHIR Condition to a provenance-tagged Problem (source table `lists`). */
export function mapFhirCondition(resource: unknown, fetchedAt: Date): Problem {
  const parsed = ConditionSchema.safeParse(resource);
  if (!parsed.success) {
    throw new SnapshotMappingError("could not map FHIR Condition resource");
  }
  const condition = parsed.data;

  const problem: { display: string; clinicalStatus?: string; provenance: Provenance } = {
    display: displayOf(condition.code) ?? "(unspecified problem)",
    provenance: provenanceOf("lists", condition.id, fetchedAt),
  };
  const clinicalStatus = condition.clinicalStatus?.coding?.find((c) => c.code !== undefined)?.code;
  if (clinicalStatus !== undefined) {
    problem.clinicalStatus = clinicalStatus;
  }
  return problem;
}

/** Map a FHIR searchset Bundle of Conditions to a Problem list. */
export function mapFhirConditions(bundle: unknown, fetchedAt: Date): Problem[] {
  return bundleResources(bundle).map((resource) => mapFhirCondition(resource, fetchedAt));
}
