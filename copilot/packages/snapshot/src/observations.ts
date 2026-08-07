import { z } from "zod";
import { bundleResources } from "./bundle.js";
import { provenanceOf, type Provenance } from "./provenance.js";

const CodingSchema = z.object({ code: z.string().optional(), display: z.string().optional() });
const QuantitySchema = z.object({ value: z.number().optional(), unit: z.string().optional() });
const ObservationSchema = z.object({
  resourceType: z.literal("Observation"),
  id: z.string().min(1),
  code: z.object({ text: z.string().optional(), coding: z.array(CodingSchema).optional() }).optional(),
  effectiveDateTime: z.string().optional(),
  valueQuantity: QuantitySchema.optional(),
  component: z
    .array(z.object({ code: z.object({ coding: z.array(CodingSchema).optional() }).optional(), valueQuantity: QuantitySchema.optional() }))
    .optional(),
  hasMember: z.array(z.unknown()).optional(),
});

/** LOINC codes with special handling. */
const LOINC_BLOOD_PRESSURE = "85354-9";
const LOINC_SYSTOLIC = "8480-6";
const LOINC_DIASTOLIC = "8462-4";

/**
 * OpenEMR emits UCUM unit codes; map the common vitals/lab ones to what a physician reads.
 * Anything not listed passes through unchanged (never dropped — a raw unit beats none).
 */
const UNIT_DISPLAY: Readonly<Record<string, string>> = {
  "mm[Hg]": "mmHg",
  lb_av: "lb",
  in_i: "in",
  "kg/m2": "kg/m²",
  degF: "°F",
  Cel: "°C",
  "[degF]": "°F",
};

function normalizeUnit(unit: string | undefined): string | undefined {
  if (unit === undefined || unit === "") {
    return undefined;
  }
  return UNIT_DISPLAY[unit] ?? unit;
}

/** One provenance-tagged observation reading (a vital sign or a lab result). */
export interface ObservationReading {
  /** The measured quantity's display name, e.g. "Heart rate", "Blood pressure". */
  readonly name: string;
  /** The value as recorded, e.g. "99", "150/80". */
  readonly value: string;
  /** Normalized unit, e.g. "mmHg", "lb"; absent when unitless. */
  readonly unit?: string;
  /** When the measurement was taken (FHIR effectiveDateTime). */
  readonly effectiveDateTime?: string;
  /** LOINC code of the measurement. */
  readonly code?: string;
  readonly provenance: Provenance;
}

/**
 * The absence-aware result. `documented:false` means *no observation of this category on
 * file* — reported as "none documented," never as "normal" (provenance-and-grounding).
 */
export type ObservationResult =
  | { readonly documented: true; readonly observations: readonly ObservationReading[] }
  | { readonly documented: false };

function codeOf(obs: z.infer<typeof ObservationSchema>): string | undefined {
  return obs.code?.coding?.find((c) => c.code !== undefined)?.code;
}

function nameOf(obs: z.infer<typeof ObservationSchema>): string {
  return (
    obs.code?.text ??
    obs.code?.coding?.find((c) => c.display !== undefined && c.display !== "")?.display ??
    "(unspecified observation)"
  );
}

/** Build the combined "systolic/diastolic" reading from a blood-pressure Observation. */
function bloodPressureValue(obs: z.infer<typeof ObservationSchema>): string | null {
  const componentValue = (loinc: string): number | undefined =>
    obs.component?.find((c) => c.code?.coding?.some((cc) => cc.code === loinc))?.valueQuantity?.value;
  const systolic = componentValue(LOINC_SYSTOLIC);
  const diastolic = componentValue(LOINC_DIASTOLIC);
  if (systolic === undefined || diastolic === undefined) {
    return null;
  }
  return `${systolic}/${diastolic}`;
}

/**
 * Map one FHIR Observation to a reading, or `null` when it carries no stateable value
 * (a panel with only `hasMember`, or a value-less leaf). Skipping value-less rows keeps an
 * absence honest — we never manufacture a reading the chart didn't record.
 */
export function mapFhirObservation(
  resource: unknown,
  sourceTable: string,
  fetchedAt: Date,
): ObservationReading | null {
  const parsed = ObservationSchema.safeParse(resource);
  if (!parsed.success) {
    return null;
  }
  const obs = parsed.data;
  const provenance = provenanceOf(sourceTable, obs.id, fetchedAt);
  const base = {
    ...(obs.effectiveDateTime !== undefined ? { effectiveDateTime: obs.effectiveDateTime } : {}),
    provenance,
  };

  if (codeOf(obs) === LOINC_BLOOD_PRESSURE) {
    const value = bloodPressureValue(obs);
    if (value === null) {
      return null;
    }
    return { name: "Blood pressure", value, unit: "mmHg", code: LOINC_BLOOD_PRESSURE, ...base };
  }

  if (obs.valueQuantity?.value !== undefined) {
    const unit = normalizeUnit(obs.valueQuantity.unit);
    const code = codeOf(obs);
    return {
      name: nameOf(obs),
      value: String(obs.valueQuantity.value),
      ...(unit !== undefined ? { unit } : {}),
      ...(code !== undefined ? { code } : {}),
      ...base,
    };
  }

  return null; // panel or value-less leaf
}

/** Map a FHIR Observation searchset Bundle to readings, dropping value-less rows. */
export function mapFhirObservations(
  bundle: unknown,
  sourceTable: string,
  fetchedAt: Date,
): ObservationReading[] {
  const readings: ObservationReading[] = [];
  for (const resource of bundleResources(bundle)) {
    const reading = mapFhirObservation(resource, sourceTable, fetchedAt);
    if (reading !== null) {
      readings.push(reading);
    }
  }
  return readings;
}

function timestampOf(reading: ObservationReading): number {
  if (reading.effectiveDateTime === undefined) {
    return 0;
  }
  const t = Date.parse(reading.effectiveDateTime);
  return Number.isNaN(t) ? 0 : t;
}

/** One plottable point in a lab time series. */
export interface LabSeriesPoint {
  /** The reading's collection date/time (FHIR effectiveDateTime). */
  readonly date: string;
  /** The parsed numeric value (only numeric readings are plotted). */
  readonly value: number;
  /** The value exactly as recorded (for the tooltip). */
  readonly rawValue: string;
  /** The Observation uuid — traces the point to its source document (click-to-source). */
  readonly obsUuid: string;
}

/** One lab test's time series: its identity, unit, and dated numeric points (ascending). */
export interface LabSeries {
  readonly test: string;
  readonly code?: string;
  readonly unit?: string;
  readonly points: readonly LabSeriesPoint[];
  /**
   * The age/sex-aware general reference range for this analyte, attached by `attachReferenceRanges`
   * for chart context. Optional: absent when the analyte or the patient's sex/age is unresolved. It
   * is a GENERAL, cited reference — not a patient finding (`w2-lab-reference-ranges`).
   */
  readonly referenceRange?: import("./referenceRanges.js").ReferenceRange;
}

/** Absence-aware trend result. `documented:false` = no lab Observations on file (never "normal"). */
export type LabSeriesResult =
  | { readonly documented: true; readonly series: readonly LabSeries[] }
  | { readonly documented: false };

/** Mutable accumulator for one series while grouping. */
interface MutableSeries {
  test: string;
  code?: string;
  unit?: string;
  points: LabSeriesPoint[];
}

/** A value we can place on a numeric y-axis (an integer/decimal, optionally signed). */
const NUMERIC_VALUE = /^-?\d+(\.\d+)?$/;

/**
 * Strip the co-pilot write-path's internal annotations from a derived Observation's display name so
 * the chart shows the clean test name. The `DerivedObservationWriter` records the test as e.g.
 * "Ferritin [co-pilot-derived from document #49, citation …] (ref 15-150)"; the physician should see
 * "Ferritin". A name without those markers passes through unchanged (native labs are already clean).
 */
function cleanLabName(name: string): string {
  const stripped = name
    .replace(/\s*\[co-pilot-derived[^\]]*\]/gi, "")
    .replace(/\s*\(ref[^)]*\)/gi, "")
    .trim();
  return stripped === "" ? name : stripped;
}

/** A LOINC-shaped code (digits-hyphen-digits), as opposed to a name used as the fallback code. */
const LOINC_CODE = /^\d+-\d+$/;

/**
 * Build per-test lab **time series** from a FHIR Observation searchset — the union of every committed
 * lab reading (across all uploaded PDFs), grouped by test over its collection dates. Unlike
 * {@link mapAndCollectObservations} (which keeps only the latest per type), this keeps every dated
 * numeric point so the widget can draw a trend. Group key is the LOINC code when present, else the
 * normalized name. A reading with no parseable date, or a non-numeric value (a trend cannot plot
 * "Negative"), is not a point — the underlying mapper only surfaces `valueQuantity` readings, so this
 * is the same numeric-only scope the rest of the labs feature already has. Points are sorted ascending
 * by date; series sorted by test name for deterministic output. Absence-aware, provenance-tagged.
 */
export function buildLabSeries(bundle: unknown, sourceTable: string, fetchedAt: Date): LabSeriesResult {
  const readings = mapFhirObservations(bundle, sourceTable, fetchedAt);
  const groups = new Map<string, MutableSeries>();

  for (const r of readings) {
    if (r.effectiveDateTime === undefined || Number.isNaN(Date.parse(r.effectiveDateTime))) {
      continue; // a trend point needs a real date to place on the time axis
    }
    const raw = r.value.trim();
    if (!NUMERIC_VALUE.test(raw)) {
      continue; // only numeric readings are plottable
    }
    // Group by the CLEANED display name, not the raw code: the same test may be coded by LOINC in one
    // document and by name in another (older commits set no LOINC), which a code key would split into
    // two lines. The cleaned name is what the physician sees and what should share a trend.
    const display = cleanLabName(r.name);
    const key = display.toLowerCase();
    let group = groups.get(key);
    if (group === undefined) {
      group = { test: display, points: [] };
      if (r.unit !== undefined) group.unit = r.unit;
      groups.set(key, group);
    }
    // Prefer a real LOINC for the series code (metadata only; not the group key).
    if (group.code === undefined && r.code !== undefined && LOINC_CODE.test(r.code)) {
      group.code = r.code;
    }
    if (group.unit === undefined && r.unit !== undefined) {
      group.unit = r.unit;
    }
    group.points.push({ date: r.effectiveDateTime, value: Number(raw), rawValue: r.value, obsUuid: r.provenance.rowUuid });
  }

  if (groups.size === 0) {
    return { documented: false };
  }
  const series: LabSeries[] = [...groups.values()]
    .map((g) => ({ ...g, points: [...g.points].sort((a, b) => Date.parse(a.date) - Date.parse(b.date)) }))
    .sort((a, b) => a.test.localeCompare(b.test));
  return { documented: true, series };
}

/**
 * Map + collapse to the **most recent reading per type** (the physician wants the current
 * value, not the whole history — minimum-necessary). Absence-aware and sorted by name for
 * deterministic output regardless of FHIR ordering.
 */
export function mapAndCollectObservations(
  bundle: unknown,
  sourceTable: string,
  fetchedAt: Date,
): ObservationResult {
  const readings = mapFhirObservations(bundle, sourceTable, fetchedAt);
  if (readings.length === 0) {
    return { documented: false };
  }
  // Group by the CLEANED, case-insensitive name so a co-pilot-derived reading (whose stored name
  // carries an internal "[co-pilot-derived from document #…]" annotation) collapses with its native
  // twin instead of showing as a second "current" value — and the physician never sees the internal
  // annotation. Mirrors buildLabSeries's cleanLabName grouping.
  const latest = new Map<string, ObservationReading>();
  for (const reading of readings) {
    const display = cleanLabName(reading.name);
    const key = display.toLowerCase();
    const cleaned = reading.name === display ? reading : { ...reading, name: display };
    const prev = latest.get(key);
    if (prev === undefined || timestampOf(reading) > timestampOf(prev)) {
      latest.set(key, cleaned);
    }
  }
  const observations = [...latest.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { documented: true, observations };
}
