/**
 * Verification layer 1 — deterministic citation check.
 *
 * Guarantees *traceability*: every clinical claim must cite at least one source,
 * and every cited source must resolve to provenance actually retrieved this turn.
 * A claim that fails is rejected (the agent must not state it); the caller
 * degrades gracefully rather than surfacing an uncited claim.
 *
 * Limitations (documented, by design): this layer does NOT check that a cited
 * source *supports* the statement (a claim can cite a real record but
 * misrepresent it — that is the semantic grounding judge, layer 2), and does NOT
 * enforce clinical constraints (layer 3). It proves attribution, not faithfulness
 * or clinical safety.
 */

export interface Claim {
  readonly statement: string;
  /** Provenance row UUIDs the model asserts support this statement. */
  readonly sourceRefs: readonly string[];
  /**
   * Optional presentation-only section header (e.g. "Active medications"). When set,
   * the response renderer groups same-header claims into a titled bullet list so an
   * enumeration doesn't read as N repeated sentences. It is metadata for rendering
   * ONLY — the citation check, grounding judge, and constraint engine ignore it.
   */
  readonly group?: string;
}

export interface CitationVerdict {
  /** True when no claim was rejected. */
  readonly ok: boolean;
  readonly verifiedClaims: readonly Claim[];
  readonly rejectedClaims: readonly Claim[];
}

/**
 * Partition claims into verified vs rejected. A claim is verified only if it has
 * at least one source ref and *every* ref resolves to a retrieved provenance id.
 */
export function checkCitations(
  claims: readonly Claim[],
  retrievedRefs: Iterable<string>,
): CitationVerdict {
  const available = new Set(retrievedRefs);
  const verifiedClaims: Claim[] = [];
  const rejectedClaims: Claim[] = [];

  for (const claim of claims) {
    const cited =
      claim.sourceRefs.length > 0 && claim.sourceRefs.every((ref) => available.has(ref));
    (cited ? verifiedClaims : rejectedClaims).push(claim);
  }

  return { ok: rejectedClaims.length === 0, verifiedClaims, rejectedClaims };
}
