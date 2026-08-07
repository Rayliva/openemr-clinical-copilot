/**
 * Diagnostic: obtain a real access token using the registered client in
 * copilot/.secrets/. Verifies the end-to-end client_credentials + private_key_jwt
 * flow against the live OpenEMR.
 *
 *   OPENEMR_BASE_URL=http://localhost:8300 pnpm --filter @copilot/openemr-client token
 */
import { importPKCS8 } from "jose";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OpenEmrTokenClient, createNodeFetch } from "../src/index.js";

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
  const privateKey = await importPKCS8(pem, "RS384");

  // client_credentials tokens carry system scopes only — drop the OIDC `openid`.
  const scope = meta.scope
    .split(" ")
    .filter((s) => s !== "openid")
    .join(" ");
  const baseUrl = process.env.OPENEMR_BASE_URL ?? meta.base_url;
  const insecureTls = (process.env.OPENEMR_INSECURE_TLS ?? "true") !== "false";

  const client = new OpenEmrTokenClient({
    baseUrl,
    clientId: meta.client_id,
    privateKey,
    scope,
    kid: meta.kid,
    fetchFn: createNodeFetch({ insecureTls }),
  });

  const token = await client.getAccessToken();
  console.log("✅ Obtained access token.");
  console.log(`token (first 40 chars): ${token.slice(0, 40)}...`);
  console.log(`length: ${token.length}`);
}

main().catch((error: unknown) => {
  console.error("token fetch failed:", error);
  process.exit(1);
});
