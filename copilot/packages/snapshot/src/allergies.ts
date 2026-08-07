import { z } from "zod";
import { bundleResources } from "./bundle.js";
import { SnapshotMappingError } from "./errors.js";
import { provenanceOf, type Provenance } from "./provenance.js";

const CodingSchema = z.object({
  code: z.string().optional(),
  display: z.string().optional(),
});
const AllergySchema = z.object({
  resourceType: z.literal("AllergyIntolerance"),
  id: z.string().min(1),
  code: z.object({ text: z.string().optional(), coding: z.array(CodingSchema).optional() }).optional(),
  criticality: z.string().optional(),
  clinicalStatus: z.object({ coding: z.array(CodingSchema).optional() }).optional(),
});

/** A provenance-tagged allergy. reaction/criticality may be absent in the source. */
export interface Allergy {
  readonly substance: string;
  readonly criticality?: string;
  readonly clinicalStatus?: string;
  readonly provenance: Provenance;
}

/**
 * The result of reading allergies. `documented: false` means *no allergy record
 * exists* — distinct from "no allergies" (which would be a documented negative).
 * The agent must say "none documented", never imply the patient is allergy-free
 * (AUDIT.md §4.5; provenance-and-grounding rule).
 */
export type AllergyResult =
  | { readonly documented: true; readonly allergies: Allergy[] }
  | { readonly documented: false };

function mapOne(resource: unknown, fetchedAt: Date): Allergy {
  const parsed = AllergySchema.safeParse(resource);
  if (!parsed.success) {
    throw new SnapshotMappingError("could not map FHIR AllergyIntolerance resource");
  }
  const source = parsed.data;

  const substance =
    source.code?.text ??
    source.code?.coding?.find((c) => c.display !== undefined && c.display.length > 0)?.display ??
    "(unspecified substance)";
  const clinicalStatus = source.clinicalStatus?.coding?.find((c) => c.code !== undefined)?.code;

  const allergy: {
    substance: string;
    criticality?: string;
    clinicalStatus?: string;
    provenance: Provenance;
  } = {
    substance,
    provenance: provenanceOf("lists", source.id, fetchedAt),
  };
  if (source.criticality !== undefined) {
    allergy.criticality = source.criticality;
  }
  if (clinicalStatus !== undefined) {
    allergy.clinicalStatus = clinicalStatus;
  }
  return allergy;
}

/** Map a FHIR searchset Bundle of AllergyIntolerance to a documented/absent result. */
export function mapFhirAllergies(bundle: unknown, fetchedAt: Date): AllergyResult {
  const resources = bundleResources(bundle);
  if (resources.length === 0) {
    return { documented: false };
  }
  return { documented: true, allergies: resources.map((r) => mapOne(r, fetchedAt)) };
}
