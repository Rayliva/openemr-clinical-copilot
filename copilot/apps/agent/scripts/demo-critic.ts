/**
 * Deterministic, offline demo of the critic gate (verification layer 4) for Grace Bello.
 *
 * Runs the REAL agent graph (assembleContext → generate → verify → grounding → constraints →
 * critic → respond) with a stubbed `generate` that drafts a mix of a grounded finding AND an
 * agent-authored action suggestion — exactly what the read-only co-pilot must NOT surface. The
 * critic withholds the directive; the answer keeps the cited finding + a boundary note. No live
 * LLM/network — same output every run, so it never fails in front of graders.
 *
 * Run:  pnpm --filter @copilot/agent exec tsx scripts/demo-critic.ts
 */
import type { PatientDemographics } from "@copilot/snapshot";
import { buildAgentGraph } from "../src/graph/graph.js";
import type { DemographicsToolFn, GenerateFn, AllergiesToolFn } from "../src/graph/types.js";

const GRACE: PatientDemographics = {
  id: "pid-grace",
  name: "Grace Bello",
  birthDate: "1990-06-18",
  gender: "female",
  provenance: { sourceTable: "patient_data", rowUuid: "pid-grace", fetchedAt: "2026-07-16T09:00:00.000Z" },
};

const demographicsTool: DemographicsToolFn = async () => ({ found: true, demographics: GRACE });
const noAllergiesTool: AllergiesToolFn = async () => ({ documented: false });

// The model's DRAFT for "her ferritin is low — what should I start her on?": one grounded finding
// (fine to surface) and one treatment directive (must be withheld). Both cite a retrieved row.
const generate: GenerateFn = async () => ({
  claims: [
    { statement: "Ferritin is 11 ng/mL (low) and hemoglobin is 11.4 g/dL (low).", sourceRefs: ["pid-grace"] },
    { statement: "Start her on ferrous sulfate 325 mg daily for the iron-deficiency anemia.", sourceRefs: ["pid-grace"] },
  ],
});

const QUESTION = "Her ferritin and hemoglobin are low — what should I start her on?";

async function main(): Promise<void> {
  const graph = buildAgentGraph({ demographicsTool, allergiesTool: noAllergiesTool, generate });
  const out = await graph.invoke({
    patientId: "pid-grace",
    messages: [{ role: "user", content: QUESTION }],
  });

  console.log("\n=== Critic gate demo — Grace Bello =====================================\n");
  console.log(`Physician: ${QUESTION}\n`);
  console.log("Model DRAFTED 2 claims:");
  console.log("  1. Ferritin is 11 ng/mL (low) and hemoglobin is 11.4 g/dL (low).   [grounded finding]");
  console.log("  2. Start her on ferrous sulfate 325 mg daily …                     [treatment directive]\n");
  console.log("----- What the physician actually sees (post-critic) -------------------\n");
  console.log(out.answer);
  console.log("\n----- Behind the gate --------------------------------------------------\n");
  console.log("Kept (in answer + citations):");
  for (const c of out.groundedClaims) console.log(`  ✓ ${c.statement}`);
  console.log("Withheld by the critic (NEVER shown to the physician or logged):");
  for (const w of out.withheld) console.log(`  ✗ [${w.reason}] ${w.claim.statement}`);
  console.log("\n=======================================================================\n");
}

void main();
