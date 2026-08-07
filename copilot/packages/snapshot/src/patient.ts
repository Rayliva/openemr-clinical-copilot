import { z } from "zod";
import { SnapshotMappingError } from "./errors.js";
import { provenanceOf, type Provenance } from "./provenance.js";

const HumanNameSchema = z.object({
  use: z.string().optional(),
  family: z.string().optional(),
  given: z.array(z.string()).optional(),
});

const FhirPatientSchema = z.object({
  resourceType: z.literal("Patient"),
  id: z.string().min(1),
  name: z.array(HumanNameSchema).optional(),
  gender: z.string().optional(),
  birthDate: z.string().optional(),
});

/** Provenance-tagged patient demographics. Absent fields stay undefined. */
export interface PatientDemographics {
  readonly id: string;
  readonly name?: string;
  readonly birthDate?: string;
  /** Whole-years age derived from `birthDate` as of the fetch time; undefined if not derivable. */
  readonly age?: number;
  readonly gender?: string;
  readonly provenance: Provenance;
}

const FULL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Whole-years age from a FHIR `birthDate` as of `asOf`. Returns null unless `birthDate` is a
 * full, valid `YYYY-MM-DD` in the past — a partial date, unparseable value, or future date
 * yields null rather than a guessed or negative age (`provenance-and-grounding`: never invent).
 */
export function computeAge(birthDate: string, asOf: Date): number | null {
  const m = FULL_DATE.exec(birthDate);
  if (m === null) {
    return null;
  }
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Reject impossible calendar dates (e.g. 2021-02-30, which Date would roll over).
  const birth = new Date(Date.UTC(year, month - 1, day));
  if (birth.getUTCFullYear() !== year || birth.getUTCMonth() !== month - 1 || birth.getUTCDate() !== day) {
    return null;
  }
  let age = asOf.getUTCFullYear() - year;
  const monthDelta = asOf.getUTCMonth() - (month - 1);
  if (monthDelta < 0 || (monthDelta === 0 && asOf.getUTCDate() < day)) {
    age -= 1;
  }
  return age < 0 ? null : age;
}

/** Map a FHIR US-Core Patient resource to provenance-tagged demographics. */
export function mapFhirPatient(resource: unknown, fetchedAt: Date): PatientDemographics {
  const parsed = FhirPatientSchema.safeParse(resource);
  if (!parsed.success) {
    throw new SnapshotMappingError("could not map FHIR Patient resource");
  }
  const patient = parsed.data;

  const demographics: {
    id: string;
    name?: string;
    birthDate?: string;
    age?: number;
    gender?: string;
    provenance: Provenance;
  } = {
    id: patient.id,
    provenance: provenanceOf("patient_data", patient.id, fetchedAt),
  };

  const name = formatName(patient.name);
  if (name !== undefined) {
    demographics.name = name;
  }
  if (patient.birthDate !== undefined) {
    demographics.birthDate = patient.birthDate;
    const age = computeAge(patient.birthDate, fetchedAt);
    if (age !== null) {
      demographics.age = age;
    }
  }
  if (patient.gender !== undefined) {
    demographics.gender = patient.gender;
  }

  return demographics;
}

type FhirName = z.infer<typeof HumanNameSchema>;

/** Prefer the official name; join given names + family. Undefined if none. */
function formatName(names: FhirName[] | undefined): string | undefined {
  if (names === undefined || names.length === 0) {
    return undefined;
  }
  const chosen = names.find((n) => n.use === "official") ?? names[0];
  if (chosen === undefined) {
    return undefined;
  }
  const parts = [...(chosen.given ?? []), chosen.family].filter(
    (part): part is string => part !== undefined && part.length > 0,
  );
  return parts.length > 0 ? parts.join(" ") : undefined;
}
