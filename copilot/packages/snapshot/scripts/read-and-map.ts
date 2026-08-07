/**
 * End-to-end diagnostic: authenticate, read the demo patient (Susan Underwood)
 * from OpenEMR FHIR, and map to provenance-tagged demographics.
 *
 *   OPENEMR_BASE_URL=https://localhost:9300 OPENEMR_INSECURE_TLS=true \
 *     pnpm --filter @copilot/snapshot read-patient
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  OpenEmrTokenClient,
  OpenEmrFhirClient,
  createNodeFetch,
  importRs384PrivateKey,
} from "@copilot/openemr-client";
import { mapFhirPatient, mapFhirConditions, mapFhirAllergies } from "../src/index.js";

const copilotRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const secretsDir = resolve(copilotRoot, ".secrets");

interface ClientMeta {
  client_id: string;
  kid: string;
  scope: string;
  base_url: string;
}

async function main(): Promise<void> {
  const meta = JSON.parse(
    await readFile(resolve(secretsDir, "openemr-client.json"), "utf8"),
  ) as ClientMeta;
  const pem = await readFile(resolve(secretsDir, "openemr-private-key.pem"), "utf8");
  const privateKey = await importRs384PrivateKey(pem);

  const baseUrl = process.env.OPENEMR_BASE_URL ?? meta.base_url;
  const insecureTls = (process.env.OPENEMR_INSECURE_TLS ?? "true") !== "false";
  const fetchFn = createNodeFetch({ insecureTls });
  const scope = meta.scope.split(" ").filter((s) => s !== "openid").join(" ");

  const tokens = new OpenEmrTokenClient({
    baseUrl,
    clientId: meta.client_id,
    privateKey,
    scope,
    kid: meta.kid,
    fetchFn,
  });
  const fhir = new OpenEmrFhirClient({
    baseUrl,
    getAccessToken: () => tokens.getAccessToken(),
    fetchFn,
  });

  const bundle = (await fhir.search("Patient", { family: "Underwood" })) as {
    entry?: Array<{ resource?: { id?: string } }>;
  };
  const id = bundle.entry?.[0]?.resource?.id;
  if (!id) {
    console.error("no patient matched");
    process.exit(1);
  }

  const now = new Date();
  const demographics = mapFhirPatient(await fhir.read("Patient", id), now);
  const problems = mapFhirConditions(await fhir.search("Condition", { patient: id }), now);
  const allergies = mapFhirAllergies(await fhir.search("AllergyIntolerance", { patient: id }), now);

  console.log("✅ read + mapped with provenance:");
  console.log("demographics:", JSON.stringify(demographics));
  console.log("problems:", JSON.stringify(problems));
  console.log("allergies:", JSON.stringify(allergies));
}

main().catch((error: unknown) => {
  console.error("read-and-map failed:", error);
  process.exit(1);
});
