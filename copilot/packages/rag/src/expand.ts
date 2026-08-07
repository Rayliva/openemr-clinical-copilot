/**
 * Deterministic clinical query expansion (`w2-contextual-retrieval`). A physician types
 * abbreviations ("a1c", "htn", "ckd") that do not lexically match the guideline prose
 * ("hemoglobin A1c", "hypertension", "chronic kidney disease"), so the keyword arm of the hybrid
 * retriever contributes nothing for them. `expandQuery` appends the canonical terms for any
 * recognized abbreviation/synonym — additive (original terms preserved), case-insensitive, and
 * scoped to the committed diabetes-primary-care corpus (not a general thesaurus). Pure + offline:
 * no model call, so it runs in CI. Unknown terms pass through unchanged.
 */

/** token -> canonical expansion terms. Curated + auditable; scoped to the corpus domain. */
const SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  a1c: ["hemoglobin", "hba1c", "glycated", "glycemic"],
  hba1c: ["hemoglobin", "a1c", "glycated", "glycemic"],
  glucose: ["glycemic", "sugar", "a1c"],
  sugar: ["glucose", "glycemic"],
  glycemic: ["glucose", "a1c"],
  dm: ["diabetes", "diabetic"],
  t2dm: ["type", "2", "diabetes"],
  diabetes: ["glycemic", "hyperglycemia"],
  htn: ["hypertension", "blood", "pressure"],
  bp: ["blood", "pressure", "hypertension"],
  hypertension: ["blood", "pressure"],
  ckd: ["chronic", "kidney", "renal", "egfr"],
  renal: ["kidney", "egfr", "creatinine"],
  kidney: ["renal", "egfr"],
  egfr: ["renal", "kidney"],
  ldl: ["cholesterol", "lipid", "statin"],
  cholesterol: ["ldl", "lipid", "statin"],
  statin: ["cholesterol", "ldl", "lipid"],
  lipid: ["cholesterol", "ldl"],
  metformin: ["first-line", "glucose", "glycemic"],
  ascvd: ["cardiovascular", "statin"],
  bmi: ["weight", "obesity"],
};

/** Match word tokens the same way the retriever tokenizes (lowercase alphanumerics). */
function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/**
 * Expand a query with canonical clinical terms for any recognized abbreviation/synonym. Returns the
 * original query followed by the (deduped) expansion terms, or the original query unchanged when
 * nothing matches. Additive: the original text is never dropped, so an exact match cannot regress.
 */
export function expandQuery(query: string): string {
  const present = new Set(tokenize(query));
  const additions: string[] = [];
  const added = new Set<string>();
  for (const token of present) {
    const expansions = SYNONYMS[token];
    if (expansions === undefined) {
      continue;
    }
    for (const term of expansions) {
      // Skip terms already in the query or already appended — keep the expansion minimal + stable.
      if (!present.has(term) && !added.has(term)) {
        additions.push(term);
        added.add(term);
      }
    }
  }
  return additions.length === 0 ? query : `${query} ${additions.join(" ")}`;
}
