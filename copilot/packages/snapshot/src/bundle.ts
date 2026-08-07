import { z } from "zod";
import { SnapshotMappingError } from "./errors.js";

const BundleSchema = z.object({
  resourceType: z.literal("Bundle"),
  entry: z.array(z.object({ resource: z.unknown() })).optional(),
});

/** Extract the resources from a FHIR searchset Bundle (empty when none). */
export function bundleResources(bundle: unknown): unknown[] {
  const parsed = BundleSchema.safeParse(bundle);
  if (!parsed.success) {
    throw new SnapshotMappingError("expected a FHIR Bundle");
  }
  return (parsed.data.entry ?? []).map((entry) => entry.resource);
}
