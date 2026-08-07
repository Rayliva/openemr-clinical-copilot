import { createAnthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { z } from "zod";
import type { GroundingFeedback } from "@copilot/verification";
import type { MedicationDosage } from "@copilot/snapshot";
import type { EvidenceSnippet } from "@copilot/rag";
import type { AssembledFacts, GenerateFn, IntakeDocument } from "./types.js";

const ClaimsSchema = z.object({
  claims: z
    .array(
      z.object({
        statement: z.string().describe("One concise factual statement answering the question."),
        sourceRefs: z
          .array(z.string())
          .describe("The source id(s) from FACTS that support this statement."),
        group: z
          .string()
          .optional()
          .describe(
            "Optional short section header (e.g. 'Active medications'). Set it ONLY when this claim is one item in an enumeration of the same kind, so the UI groups them as a bullet list. Leave unset for a single fact or a reasoning answer.",
          ),
      }),
    )
    .describe("The grounded claims. Empty if the FACTS do not answer the question."),
});

const SYSTEM_PROMPT = [
  "You are a clinical co-pilot assisting a primary-care physician about ONE patient.",
  "The physician has seconds, not minutes — be brief.",
  "",
  "Rules:",
  "- Answer using ONLY the FACTS provided below. Do not use outside medical knowledge, and do not guess.",
  "- For a medication date question (when it was prescribed / started / filled / written), answer with that medication's `dated` value on file — give the exact date, and cite that source row. If a medication has no date on file, say the date is not documented; never invent one.",
  "- For an age question (how old / age), answer with the `age` value in demographics (cite the patient row); do NOT restate the date of birth unless the DOB is what was asked. If no age is on file, say age is not documented; never compute one yourself.",
  "- Every claim MUST cite the source id(s) it comes from, in sourceRefs (use the exact `source id` shown with each fact).",
  "- If the FACTS do not contain the answer, return an empty claims array — do not fabricate.",
  "- Be concise: return only the few claims that directly answer THIS question. Omit anything not asked. One short sentence per claim; no preamble.",
  "- When the answer ENUMERATES items of one kind (medications, allergies, problems, immunizations), set each claim's `group` to a short header (e.g. 'Active medications') and make each `statement` the item ALONE (e.g. 'Lisinopril 10 mg'). The header already conveys the category AND status — do NOT repeat them in each item (never 'Lisinopril 10 mg — active' under an 'Active medications' header, never 'X is an active medication'). For a single fact or a reasoning answer, leave `group` unset and write a normal sentence.",
  "- Do NOT add disclaimers, caveats, hedges, or safety warnings — a separate deterministic layer appends those. Never restate them in your claims.",
].join("\n");

/**
 * A source whose read *failed* is not a source with no data. Say so explicitly, or
 * the model will read the silence as a documented absence and reassure the physician
 * that (say) there are no medications on file (`provenance-and-grounding` rule).
 */
function renderUnavailable(facts: AssembledFacts): string[] {
  if (facts.unavailableSources.length === 0) {
    return [];
  }
  return [
    `UNAVAILABLE SOURCES: ${facts.unavailableSources.join(", ")}. These reads FAILED — the data could not be retrieved. This is NOT an absence of data. If the question depends on one of these, say the source could not be read and that you cannot confirm; never report it as "none documented" or "none on file".`,
  ];
}

function renderDemographics(facts: AssembledFacts): string[] {
  const demo = facts.demographics;
  if (demo === null) {
    return [];
  }
  const lines = [`Patient demographics [source id: ${demo.provenance.rowUuid}]:`];
  if (demo.name !== undefined) lines.push(`  name: ${demo.name}`);
  if (demo.birthDate !== undefined) lines.push(`  date of birth: ${demo.birthDate}`);
  if (demo.age !== undefined) lines.push(`  age: ${demo.age} years`);
  if (demo.gender !== undefined) lines.push(`  gender: ${demo.gender}`);
  return lines;
}

function renderProblems(facts: AssembledFacts): string[] {
  const problems = facts.problems;
  if (problems === null) {
    return [];
  }
  if (!problems.documented) {
    return [
      "Problem list: none documented (no problem/condition record on file — treat as unknown, NOT as 'no problems').",
    ];
  }
  const lines = ["Active problem list:"];
  for (const p of problems.problems) {
    const status = p.clinicalStatus !== undefined ? ` (${p.clinicalStatus})` : "";
    lines.push(`  ${p.display}${status} [source id: ${p.provenance.rowUuid}]`);
  }
  return lines;
}

function renderMedications(facts: AssembledFacts): string[] {
  const meds = facts.medications;
  if (meds === null) {
    return [];
  }
  if (!meds.documented) {
    return ["Medications: none documented (no medication record on file — treat as unknown, not confirmed none)."];
  }
  const lines = ["Medications (reconciled across the lists + prescriptions tables):"];
  for (const med of meds.medications) {
    const sources = med.sources
      .map(
        (s) =>
          `${s.sourceTable}=${s.status}${s.authoredOn !== undefined ? `, dated ${s.authoredOn}` : ""}${renderDosage(s.dosage)} [source id: ${s.provenance.rowUuid}]`,
      )
      .join(", ");
    const conflict = med.hasConflict ? " CONFLICT: sources disagree on active status." : "";
    lines.push(`  ${med.drug} — reconciled status: ${med.status}. Sources: ${sources}.${conflict}`);
  }
  return lines;
}

/**
 * Render a source's recorded dosage inline so the model can state and cite it against that
 * row. Absent dosage renders as nothing — so a med with no dose on file stays a documented
 * absence, and the model reports "dose not documented" rather than inventing one.
 */
function renderDosage(dosage: MedicationDosage | undefined): string {
  if (dosage === undefined) {
    return "";
  }
  const parts: string[] = [];
  if (dosage.dose !== undefined) parts.push(`dose ${dosage.dose}`);
  if (dosage.route !== undefined) parts.push(`route ${dosage.route}`);
  if (dosage.text !== undefined) parts.push(`sig "${dosage.text}"`);
  return parts.length > 0 ? ` (${parts.join("; ")})` : "";
}

function renderAllergies(facts: AssembledFacts): string[] {
  const allergies = facts.allergies;
  if (allergies === null) {
    return [];
  }
  if (!allergies.documented) {
    return ["Allergies: none documented (no allergy record on file — treat as unknown, NOT as 'no allergies' or 'safe')."];
  }
  const lines = ["Allergies:"];
  for (const a of allergies.allergies) {
    const crit = a.criticality !== undefined ? `, criticality ${a.criticality}` : "";
    lines.push(`  ${a.substance}${crit} [source id: ${a.provenance.rowUuid}]`);
  }
  return lines;
}

function renderVitals(facts: AssembledFacts): string[] {
  const vitals = facts.vitals;
  if (vitals === null) {
    return [];
  }
  if (!vitals.documented) {
    return ["Vital signs: none on file (no vital-signs record — report as 'none documented,' NOT as 'normal')."];
  }
  const lines = ["Latest vital signs (most recent reading per type):"];
  for (const v of vitals.observations) {
    const unit = v.unit !== undefined ? ` ${v.unit}` : "";
    const when = v.effectiveDateTime !== undefined ? ` (${v.effectiveDateTime})` : "";
    lines.push(`  ${v.name}: ${v.value}${unit}${when} [source id: ${v.provenance.rowUuid}]`);
  }
  return lines;
}

function renderLabs(facts: AssembledFacts): string[] {
  const labs = facts.labs;
  if (labs === null) {
    return [];
  }
  if (!labs.documented) {
    return ["Lab results: none on file (no lab record — report as 'none documented,' NOT as 'normal'; a missing lab is not a normal lab)."];
  }
  const lines = ["Latest lab results (most recent result per type):"];
  for (const l of labs.observations) {
    const unit = l.unit !== undefined ? ` ${l.unit}` : "";
    const when = l.effectiveDateTime !== undefined ? ` (${l.effectiveDateTime})` : "";
    lines.push(`  ${l.name}: ${l.value}${unit}${when} [source id: ${l.provenance.rowUuid}]`);
  }
  return lines;
}

function renderImmunizations(facts: AssembledFacts): string[] {
  const immunizations = facts.immunizations;
  if (immunizations === null) {
    return [];
  }
  if (!immunizations.documented) {
    return [
      "Immunizations: none on file (no immunization record — report as 'none documented,' do NOT compute which vaccines are missing).",
    ];
  }
  const lines = ["Immunizations on file:"];
  for (const i of immunizations.immunizations) {
    const when = i.date !== undefined ? ` on ${i.date}` : "";
    const status = i.status !== undefined ? ` [${i.status}]` : "";
    lines.push(`  ${i.vaccine}${when}${status} [source id: ${i.provenance.rowUuid}]`);
  }
  return lines;
}

/**
 * Compose the FACTS block the model is given. Exported for unit testing: this encodes the
 * safety-critical absence-vs-negative framing and the `[source id: …]` tags the citation
 * gate depends on the model echoing.
 */
export function renderFacts(facts: AssembledFacts): string {
  const sections = [
    ...renderUnavailable(facts),
    ...renderDemographics(facts),
    ...renderProblems(facts),
    ...renderMedications(facts),
    ...renderAllergies(facts),
    ...renderVitals(facts),
    ...renderLabs(facts),
    ...renderImmunizations(facts),
  ];
  return sections.length > 0 ? sections.join("\n") : "No patient record was retrieved for this request.";
}

/**
 * Render retrieved guideline evidence as a SEPARATE, labeled block, each snippet cited by its
 * `chunkId` (a namespace distinct from chart row uuids). Absent on chart-only turns — the block
 * then never appears and the answer path is unchanged (`w2-multi-agent-orchestration`: guideline
 * evidence and patient-record facts stay separate).
 */
function renderEvidence(evidence: readonly EvidenceSnippet[] | undefined): string {
  if (evidence === undefined || evidence.length === 0) {
    return "";
  }
  const lines = evidence.map((e) => `  [source id: ${e.chunkId}] ${e.doc} › ${e.section}: ${e.text}`);
  // The instruction lives HERE (not in the base system prompt) so a chart-only turn's prompt is
  // unchanged. Cite guideline claims to a guideline source id; keep them separate from chart facts.
  return [
    "",
    "",
    "GUIDELINE EVIDENCE (retrieved clinical-guideline text — REFERENCE guidance, NOT a finding in",
    "THIS patient's chart). You MAY answer guideline/recommendation questions from this block,",
    "citing the guideline source id. PARAPHRASE the guidance in your own concise clinical words — do",
    "NOT quote the guideline text verbatim: the cited source already shows the exact passage to the",
    "physician, so a verbatim quote in your answer just repeats it. NEVER state a guideline as if it",
    "were documented in this chart, and NEVER cite a chart fact to a guideline id or mix chart +",
    "guideline ids in one claim:",
    ...lines,
  ].join("\n");
}

/**
 * Render the patient's on-file documents (W2 intake-extractor worker) as a SEPARATE, labeled
 * block, each cited by its `DocumentReference` source id — a namespace distinct from chart row
 * uuids AND guideline chunk ids, so a document claim is gated exactly like a chart/guideline claim
 * but never merged with one. Presence is the "we looked" signal:
 *   - `undefined` → the worker did not run this turn: no block appears (chart-only path unchanged).
 *   - an EMPTY array → the worker ran and found nothing: report a documented absence ("none on
 *     file"), never a fabricated document (`provenance-and-grounding`: absence ≠ negative finding).
 */
export function renderDocuments(documents: readonly IntakeDocument[] | undefined): string {
  if (documents === undefined) {
    return "";
  }
  if (documents.length === 0) {
    return [
      "",
      "",
      "DOCUMENTS ON FILE: none on file (no uploaded document found for this patient — report as",
      "'no documents on file,' NOT as a fabricated document, and NOT as a chart finding).",
    ].join("\n");
  }
  const lines = documents.map((d) => `  [source id: ${d.provenance.rowUuid}] ${d.title} (type: ${d.docType})`);
  return [
    "",
    "",
    "DOCUMENTS ON FILE (uploaded documents attached to THIS patient's chart — you MAY answer",
    "'what documents / is there an intake form / lab PDF on file' from this block, citing the",
    "document's source id. These are documents attached to the chart, NOT extracted clinical",
    "findings: never state a document's contents as a chart finding, and never mix a document id",
    "with a chart or guideline id in one claim):",
    ...lines,
  ].join("\n");
}

/**
 * Salvage Claude's occasional double-encoded structured output: instead of `{claims:[...]}` it
 * sometimes returns `{claims:"<the JSON as a string>"}`, which fails the schema (`claims` expected
 * array, got string). This is wired into `generateObject`'s repair hook — called ONLY when the
 * object fails to validate — so it unwraps the stringified value; returns null when no repair
 * applies (already-valid output never reaches here) or the text is genuinely unusable.
 */
export function repairClaimsText(text: string): string | null {
  let outer: unknown;
  try {
    outer = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof outer !== "object" || outer === null || !("claims" in outer)) {
    return null;
  }
  const claims = (outer as { claims: unknown }).claims;
  if (typeof claims !== "string") {
    return null; // `claims` is already an array (or something else) — not the double-encoding case
  }
  let inner: unknown;
  try {
    inner = JSON.parse(claims);
  } catch {
    return null;
  }
  if (Array.isArray(inner)) {
    return JSON.stringify({ claims: inner });
  }
  if (typeof inner === "object" && inner !== null && Array.isArray((inner as { claims?: unknown }).claims)) {
    return JSON.stringify({ claims: (inner as { claims: unknown[] }).claims });
  }
  return null;
}

/** Default deadline on the generation call so a stalled provider degrades, not hangs. */
const DEFAULT_LLM_TIMEOUT_MS = 60_000;

export interface ClaudeGenerateOptions {
  readonly apiKey: string;
  readonly model: string;
  /** Abort the generation after this many ms (default 60s). Bounds the hot path. */
  readonly timeoutMs?: number;
}

// Sonnet-class price estimate (USD per million tokens) for cost accounting. This
// is an estimate for observability, not billing — adjust if pricing is known.
const INPUT_USD_PER_MTOK = 3;
const OUTPUT_USD_PER_MTOK = 15;

function estimateCostUsd(promptTokens: number, completionTokens: number): number {
  return (
    (promptTokens / 1_000_000) * INPUT_USD_PER_MTOK +
    (completionTokens / 1_000_000) * OUTPUT_USD_PER_MTOK
  );
}

/**
 * The bounded regenerate-with-feedback step (`verification-gate` rule) hands back the
 * grounding judge's per-claim reasons. Render them as a revise-and-tighten instruction
 * so the model drops or corrects the unsupported claims — never widening its answer.
 * Empty/absent on the normal first call.
 */
function renderFeedback(feedback: readonly GroundingFeedback[] | undefined): string {
  if (feedback === undefined || feedback.length === 0) {
    return "";
  }
  const lines = feedback.map((f) => `- "${f.statement}" — ${f.reason}`);
  return [
    "",
    "",
    "REVISION REQUIRED: a verification pass could not ground these claims from your",
    "previous answer against their cited evidence. Drop or correct them, keep only",
    "claims the FACTS above directly support, and do NOT widen your answer to",
    "compensate:",
    ...lines,
  ].join("\n");
}

/**
 * The real LLM boundary: Claude via the Vercel AI SDK, producing structured
 * `{ statement, sourceRefs }` claims constrained to the retrieved FACTS. The
 * downstream citation check enforces that the cited refs were actually retrieved.
 */
export function createClaudeGenerate(options: ClaudeGenerateOptions): GenerateFn {
  const anthropic = createAnthropic({ apiKey: options.apiKey });
  const model = anthropic(options.model);

  const timeoutMs = options.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS;

  return async ({ messages, facts, feedback, evidence, documents }) => {
    const result = await generateObject({
      model,
      schema: ClaimsSchema,
      // claude-sonnet-5 only accepts the default temperature; passing 1 explicitly
      // avoids the provider sending a value the model rejects.
      temperature: 1,
      // Bound the request-serving LLM call; on timeout it throws and the generate node
      // degrades gracefully instead of the /chat request hanging indefinitely.
      abortSignal: AbortSignal.timeout(timeoutMs),
      system: `${SYSTEM_PROMPT}\n\nFACTS:\n${renderFacts(facts)}${renderEvidence(evidence)}${renderDocuments(documents)}${renderFeedback(feedback)}`,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      // Claude sometimes double-encodes the object as {claims:"<json string>"}; salvage it rather
      // than throw + degrade the whole turn (was a ~50% failure rate on longer guideline answers).
      experimental_repairText: async ({ text }) => repairClaimsText(text),
    });

    return {
      // Normalize the optional group: keep it only when the model set a non-empty header
      // (respects exactOptionalPropertyTypes — `group` is absent rather than `undefined`).
      claims: result.object.claims.map((c) => ({
        statement: c.statement,
        sourceRefs: c.sourceRefs,
        ...(c.group !== undefined && c.group.trim() !== "" ? { group: c.group } : {}),
      })),
      usage: {
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        costUsd: estimateCostUsd(result.usage.promptTokens, result.usage.completionTokens),
      },
    };
  };
}
