import type { Claim } from "@copilot/verification";

/**
 * Drop a trailing status qualifier (e.g. " — active", " (stopped)") from an item when its
 * group header already conveys that status — so under an "Active medications" header an item
 * reads "Sumatriptan 50 mg PRN", not "Sumatriptan 50 mg PRN — active". Only strips when the
 * header actually contains that status word, so a mixed "Medications" list keeps per-item
 * status. Conservative by design: the item text is otherwise untouched.
 */
function stripRedundantStatus(header: string, item: string): string {
  const headerLc = header.toLowerCase();
  return item.replace(
    /\s*(?:[—-]\s*(active|inactive|stopped|completed)|\((active|inactive|stopped|completed)\))\s*$/i,
    (match, dashStatus?: string, parenStatus?: string) => {
      const status = (dashStatus ?? parenStatus ?? "").toLowerCase();
      return headerLc.includes(status) ? "" : match;
    },
  );
}

/**
 * Compose the answer body from grounded claims (see `docs/specs/response-formatting.md`).
 *
 * The claims are the verified data model; this is a pure *view* over them (kept out of the
 * LangGraph node per `orchestrator-only`). Three shapes:
 *  - Ungrouped claims → a prose paragraph (space-joined). Identical to the prior behavior,
 *    so single-fact / reasoning answers don't regress.
 *  - A group with a single item → an inline "Header: item" sentence — a one-item list is
 *    noise, so we just state it.
 *  - A group with 2+ items (an optional, presentation-only `group` header) → a header line
 *    followed by a bullet list, so an enumeration reads as one header + N items instead of N
 *    near-identical lines.
 *
 * When both prose and groups are present the prose leads, then each group block, separated by
 * a blank line. `group` is inert to every verification layer — grouping is purely presentation.
 */
export function renderAnswerBody(claims: readonly Claim[]): string {
  const prose: string[] = [];
  const groups = new Map<string, string[]>();

  for (const claim of claims) {
    const header = claim.group?.trim();
    if (header === undefined || header === "") {
      prose.push(claim.statement);
      continue;
    }
    const item = stripRedundantStatus(header, claim.statement);
    const bucket = groups.get(header);
    if (bucket === undefined) {
      groups.set(header, [item]);
    } else {
      bucket.push(item);
    }
  }

  const blocks: string[] = [];
  if (prose.length > 0) {
    blocks.push(prose.join(" "));
  }
  for (const [header, items] of groups) {
    if (items.length === 1) {
      blocks.push(`${header}: ${items[0] ?? ""}`);
    } else {
      blocks.push(`${header}\n${items.map((s) => `- ${s}`).join("\n")}`);
    }
  }

  return blocks.join("\n\n");
}
