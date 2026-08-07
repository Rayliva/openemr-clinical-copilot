/**
 * One-time setup: register the SMART backend-services OAuth2 client in OpenEMR.
 *
 * Generates an RS384 keypair, registers a confidential `private_key_jwt` client
 * with inline JWKS and system read scopes, and writes the private key + client_id
 * to copilot/.secrets/ (git-ignored). Re-runnable (creates a fresh client each
 * time). See .claude/skills/register-oauth-client.md.
 *
 *   OPENEMR_BASE_URL=http://localhost:8300 pnpm --filter @copilot/openemr-client register
 */
import { generateKeyPair, exportPKCS8, exportJWK } from "jose";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createNodeFetch } from "../src/index.js";

const BASE_URL = (process.env.OPENEMR_BASE_URL ?? "https://localhost:9300").replace(/\/$/, "");
const INSECURE_TLS = (process.env.OPENEMR_INSECURE_TLS ?? "true") !== "false";
const fetchFn = createNodeFetch({ insecureTls: INSECURE_TLS });
const CLIENT_NAME = "Clinical Co-Pilot Agent";
const SYSTEM_SCOPES = [
  "system/Patient.read",
  "system/Condition.read",
  "system/MedicationRequest.read",
  "system/AllergyIntolerance.read",
  "system/Observation.read",
  "system/Encounter.read",
  "system/Immunization.read",
  // Week 2 document ingestion — list uploaded source documents + fetch their bytes.
  // Read-only: the derived-fact WRITE goes through the OpenEMR module, not this client
  // (w2-ingest-document, register-oauth-client skill). No write scope requested.
  "system/DocumentReference.read",
  "system/Binary.read",
];
const SCOPE = ["openid", ...SYSTEM_SCOPES].join(" ");

const copilotRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const secretsDir = resolve(copilotRoot, ".secrets");

async function main(): Promise<void> {
  const { publicKey, privateKey } = await generateKeyPair("RS384", {
    modulusLength: 2048,
    extractable: true,
  });
  const kid = randomUUID();
  const privatePem = await exportPKCS8(privateKey);
  const publicJwk = await exportJWK(publicKey);
  const jwk = { ...publicJwk, kid, alg: "RS384", use: "sig" };

  const registration = {
    application_type: "private",
    // Required by OpenEMR's registration even though client_credentials never
    // redirects — the URI is never exercised by this backend client.
    redirect_uris: ["http://localhost:3000/callback"],
    client_name: CLIENT_NAME,
    token_endpoint_auth_method: "private_key_jwt",
    grant_types: ["client_credentials"],
    response_types: [],
    jwks: { keys: [jwk] },
    scope: SCOPE,
    contacts: ["copilot@example.com"],
  };

  console.log(`Registering "${CLIENT_NAME}" at ${BASE_URL}/oauth2/default/registration`);
  console.log(`Scopes: ${SCOPE}`);

  const response = await fetchFn(`${BASE_URL}/oauth2/default/registration`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(registration),
  });

  const text = await response.text();
  if (!response.ok) {
    console.error(`Registration failed (HTTP ${response.status}):\n${text}`);
    process.exit(1);
  }

  const body = JSON.parse(text) as { client_id?: string; scope?: string };
  if (!body.client_id) {
    console.error(`Registration response missing client_id:\n${text}`);
    process.exit(1);
  }

  await mkdir(secretsDir, { recursive: true });
  await writeFile(resolve(secretsDir, "openemr-private-key.pem"), privatePem, "utf8");
  await writeFile(
    resolve(secretsDir, "openemr-client.json"),
    JSON.stringify({ client_id: body.client_id, kid, scope: SCOPE, base_url: BASE_URL }, null, 2),
    "utf8",
  );

  console.log("\n✅ Registered.");
  console.log(`client_id: ${body.client_id}`);
  console.log(`granted scope: ${body.scope ?? "(not echoed)"}`);
  console.log(`Saved: ${resolve(secretsDir, "openemr-private-key.pem")}`);
  console.log(`Saved: ${resolve(secretsDir, "openemr-client.json")}`);
  console.log(
    "\nNOTE: a newly-registered client is disabled and role=user by default. For a" +
      " backend system client it must be enabled AND set to the system role before" +
      " it can obtain a token. Do it in Administration → System → API Clients, or in" +
      " dev via SQL:\n" +
      `  UPDATE oauth_clients SET is_enabled=1, client_role='system' WHERE client_id='${body.client_id}';`,
  );
}

main().catch((error: unknown) => {
  console.error("register script error:", error);
  process.exit(1);
});
