/** Raised when a FHIR resource cannot be mapped to the expected shape. */
export class SnapshotMappingError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SnapshotMappingError";
  }
}
