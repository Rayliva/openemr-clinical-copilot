import { z } from "zod";
import { bundleResources } from "./bundle.js";
import { SnapshotMappingError } from "./errors.js";
import { provenanceOf, type Provenance } from "./provenance.js";

const CodingSchema = z.object({
  code: z.string().optional(),
  display: z.string().optional(),
});
const DosageInstructionSchema = z.object({
  text: z.string().optional(),
  route: z.object({ text: z.string().optional(), coding: z.array(CodingSchema).optional() }).optional(),
  doseAndRate: z
    .array(z.object({ doseQuantity: z.object({ value: z.number().optional(), unit: z.string().optional() }).optional() }))
    .optional(),
});
const MedicationRequestSchema = z.object({
  resourceType: z.literal("MedicationRequest"),
  id: z.string().min(1),
  status: z.string().min(1),
  intent: z.string().optional(),
  medicationCodeableConcept: z
    .object({ text: z.string().optional(), coding: z.array(CodingSchema).optional() })
    .optional(),
  dosageInstruction: z.array(DosageInstructionSchema).optional(),
  authoredOn: z.string().optional(),
});

/** The OpenEMR table a med row came from, derived from FHIR `intent`. */
export type MedicationSourceTable = "prescriptions" | "lists";

/** FHIR MedicationRequest `intent` → OpenEMR source table (AUDIT.md §4.1). */
const INTENT_TO_TABLE: Readonly<Record<string, MedicationSourceTable>> = {
  order: "prescriptions",
  plan: "lists",
};

/**
 * The dosage on a prescription, as far as it is recorded. Every field is optional — a
 * prescription may carry a free-text SIG, a structured dose, a route, or nothing. Absent
 * (not an empty object) when the record has no dosage, so "no dose on file" stays distinct.
 */
export interface MedicationDosage {
  /** SIG / free-text instruction, e.g. "2 puffs every 4 hours as needed". */
  readonly text?: string;
  /** Structured dose, e.g. "90 mcg" (or just "90" when no unit is recorded). */
  readonly dose?: string;
  /** Route of administration, e.g. "Inhalation". */
  readonly route?: string;
}

/** One medication row from a single source, provenance-tagged (pre-reconciliation). */
export interface MedicationSource {
  readonly drug: string;
  readonly sourceTable: MedicationSourceTable;
  /** Raw FHIR status (e.g. "active", "stopped", "completed"). */
  readonly status: string;
  /** Whether this source considers the med active. */
  readonly active: boolean;
  readonly provenance: Provenance;
  /** Dosage as recorded on the prescription; absent when none is documented. */
  readonly dosage?: MedicationDosage;
  /**
   * The prescription date OpenEMR shows (FHIR `authoredOn`, from `prescriptions.date_added`),
   * ISO date. Absent for rows that carry no date (e.g. `intent=plan` list entries).
   */
  readonly authoredOn?: string;
}

/** Reconciled active-ness across the sources of one drug. */
export type ReconciledStatus = "active" | "inactive" | "conflicted";

/** One drug after unioning its sources, with conflicts surfaced (never resolved). */
export interface ReconciledMedication {
  readonly drug: string;
  readonly sources: readonly MedicationSource[];
  readonly status: ReconciledStatus;
  readonly hasConflict: boolean;
  /** Every contributing row's provenance — a conflict claim can cite them all. */
  readonly provenance: readonly Provenance[];
}

/**
 * The absence-aware result. `documented: false` means *no medication record exists*
 * — distinct from "no medications," which the agent must never imply
 * (provenance-and-grounding).
 */
export type MedicationResult =
  | { readonly documented: true; readonly medications: readonly ReconciledMedication[] }
  | { readonly documented: false };

function drugNameOf(concept: z.infer<typeof MedicationRequestSchema>["medicationCodeableConcept"]): string {
  if (concept?.text !== undefined && concept.text.length > 0) {
    return concept.text;
  }
  const display = concept?.coding?.find((c) => c.display !== undefined && c.display.length > 0)?.display;
  return display ?? "(unspecified medication)";
}

/**
 * Extract the recorded dosage from the first `dosageInstruction`, or `undefined` when none
 * of SIG text / structured dose / route is present. Only the first instruction is read
 * (documented limitation); multi-line regimens surface their first line.
 */
function dosageOf(
  instructions: z.infer<typeof MedicationRequestSchema>["dosageInstruction"],
): MedicationDosage | undefined {
  const first = instructions?.[0];
  if (first === undefined) {
    return undefined;
  }
  const text = first.text?.trim();
  const quantity = first.doseAndRate?.find((d) => d.doseQuantity?.value !== undefined)?.doseQuantity;
  const dose =
    quantity?.value !== undefined
      ? `${quantity.value}${quantity.unit !== undefined && quantity.unit !== "" ? ` ${quantity.unit}` : ""}`
      : undefined;
  const route =
    first.route?.text?.trim() ??
    first.route?.coding?.find((c) => c.display !== undefined && c.display !== "")?.display;

  const dosage: MedicationDosage = {
    ...(text !== undefined && text !== "" ? { text } : {}),
    ...(dose !== undefined ? { dose } : {}),
    ...(route !== undefined && route !== "" ? { route } : {}),
  };
  return Object.keys(dosage).length > 0 ? dosage : undefined;
}

/** Map one FHIR MedicationRequest to a provenance-tagged `MedicationSource`. */
export function mapFhirMedicationRequest(resource: unknown, fetchedAt: Date): MedicationSource {
  const parsed = MedicationRequestSchema.safeParse(resource);
  if (!parsed.success) {
    throw new SnapshotMappingError("could not map FHIR MedicationRequest resource");
  }
  const request = parsed.data;

  const sourceTable = request.intent !== undefined ? INTENT_TO_TABLE[request.intent] : undefined;
  if (sourceTable === undefined) {
    throw new SnapshotMappingError(
      "FHIR MedicationRequest has unknown/missing intent; cannot determine source table",
    );
  }

  const dosage = dosageOf(request.dosageInstruction);
  const authoredOn = request.authoredOn?.trim();
  return {
    drug: drugNameOf(request.medicationCodeableConcept),
    sourceTable,
    status: request.status,
    active: request.status === "active",
    provenance: provenanceOf(sourceTable, request.id, fetchedAt),
    ...(dosage !== undefined ? { dosage } : {}),
    ...(authoredOn !== undefined && authoredOn !== "" ? { authoredOn } : {}),
  };
}

/**
 * Map every entry of a MedicationRequest searchset Bundle to `MedicationSource[]`.
 *
 * A single unmappable resource (e.g. an unknown FHIR `intent`) is SKIPPED rather than
 * throwing, so one malformed row does not discard the entire medication list — losing
 * every med is a worse outcome than losing one. A non-Bundle body still throws at the
 * `bundleResources` boundary (that is the whole read failing, handled upstream).
 */
export function mapFhirMedications(bundle: unknown, fetchedAt: Date): MedicationSource[] {
  const out: MedicationSource[] = [];
  for (const resource of bundleResources(bundle)) {
    try {
      out.push(mapFhirMedicationRequest(resource, fetchedAt));
    } catch (error) {
      if (error instanceof SnapshotMappingError) {
        continue; // skip this one row; keep the mappable ones
      }
      throw error;
    }
  }
  return out;
}

function normalizeName(drug: string): string {
  return drug.trim().toLowerCase();
}

/**
 * Reconcile per-source medication rows into one list per drug. Conflicts are
 * *surfaced*, never resolved: a drug active in one source and inactive in another
 * is marked `"conflicted"` with both rows' provenance, so the physician sees the
 * disagreement and both citations (UC-3). Output is sorted by normalized name for
 * determinism regardless of FHIR ordering.
 */
export function reconcileMeds(sources: readonly MedicationSource[]): ReconciledMedication[] {
  const groups = new Map<string, MedicationSource[]>();
  for (const source of sources) {
    const key = normalizeName(source.drug);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [source]);
    } else {
      group.push(source);
    }
  }

  const reconciled: ReconciledMedication[] = [];
  for (const [, group] of groups) {
    const anyActive = group.some((s) => s.active);
    const anyInactive = group.some((s) => !s.active);
    const status: ReconciledStatus = anyActive && anyInactive ? "conflicted" : anyActive ? "active" : "inactive";
    reconciled.push({
      drug: group[0]!.drug,
      sources: group,
      status,
      hasConflict: status === "conflicted",
      provenance: group.map((s) => s.provenance),
    });
  }

  return reconciled.sort((a, b) => normalizeName(a.drug).localeCompare(normalizeName(b.drug)));
}

/** Map a MedicationRequest Bundle and reconcile it, absence-aware for the tool layer. */
export function mapAndReconcileMedications(bundle: unknown, fetchedAt: Date): MedicationResult {
  const sources = mapFhirMedications(bundle, fetchedAt);
  if (sources.length === 0) {
    return { documented: false };
  }
  return { documented: true, medications: reconcileMeds(sources) };
}
