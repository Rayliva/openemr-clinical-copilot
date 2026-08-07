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
const ImmunizationSchema = z.object({
  resourceType: z.literal("Immunization"),
  id: z.string().min(1),
  status: z.string().optional(),
  vaccineCode: CodeableConceptSchema.optional(),
  occurrenceDateTime: z.string().optional(),
});

/** A provenance-tagged immunization record (source table `immunizations`). */
export interface Immunization {
  readonly vaccine: string;
  readonly status?: string;
  /** Administration date (occurrenceDateTime), when recorded. */
  readonly date?: string;
  readonly provenance: Provenance;
}

function vaccineNameOf(code: z.infer<typeof CodeableConceptSchema> | undefined): string {
  if (code === undefined) {
    return "(unspecified vaccine)";
  }
  if (code.text !== undefined && code.text.length > 0) {
    return code.text;
  }
  const withDisplay = code.coding?.find((c) => c.display !== undefined && c.display.length > 0);
  if (withDisplay?.display !== undefined) {
    return withDisplay.display;
  }
  // Fall back to the raw CVX code so the record is still identifiable, never dropped.
  const withCode = code.coding?.find((c) => c.code !== undefined && c.code.length > 0);
  return withCode?.code ?? "(unspecified vaccine)";
}

/** Map a FHIR Immunization to a provenance-tagged record. */
export function mapFhirImmunization(resource: unknown, fetchedAt: Date): Immunization {
  const parsed = ImmunizationSchema.safeParse(resource);
  if (!parsed.success) {
    throw new SnapshotMappingError("could not map FHIR Immunization resource");
  }
  const immunization = parsed.data;

  const record: { vaccine: string; status?: string; date?: string; provenance: Provenance } = {
    vaccine: vaccineNameOf(immunization.vaccineCode),
    provenance: provenanceOf("immunizations", immunization.id, fetchedAt),
  };
  if (immunization.status !== undefined) {
    record.status = immunization.status;
  }
  if (immunization.occurrenceDateTime !== undefined) {
    record.date = immunization.occurrenceDateTime;
  }
  return record;
}

/** Map a FHIR searchset Bundle of Immunizations to a list. */
export function mapFhirImmunizations(bundle: unknown, fetchedAt: Date): Immunization[] {
  return bundleResources(bundle).map((resource) => mapFhirImmunization(resource, fetchedAt));
}
