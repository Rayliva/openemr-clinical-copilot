/**
 * The origin of a single assembled fact. Every fact the agent surfaces carries
 * provenance so each claim can be traced to the OpenEMR row it came from
 * (ARCHITECTURE.md §2.3; provenance-and-grounding rule).
 */
export interface Provenance {
  /** OpenEMR source table, e.g. "patient_data", "lists", "prescriptions". */
  readonly sourceTable: string;
  /** The source row's UUID (the FHIR resource id). */
  readonly rowUuid: string;
  /** When the fact was fetched, ISO 8601. */
  readonly fetchedAt: string;
}

/** Build a Provenance value from a source table, row UUID, and fetch time. */
export function provenanceOf(sourceTable: string, rowUuid: string, fetchedAt: Date): Provenance {
  return { sourceTable, rowUuid, fetchedAt: fetchedAt.toISOString() };
}
