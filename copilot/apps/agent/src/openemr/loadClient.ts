import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { OpenEmrFhirClient, OpenEmrTokenClient, importRs384PrivateKey } from "@copilot/openemr-client";

/**
 * Load the registered OpenEMR OAuth client from `.secrets` and build an authenticated FHIR client.
 * Shared by the ingestion service (and available to any edge that reads FHIR); returns `null` when
 * the client is not registered / config is malformed, so the caller degrades cleanly rather than
 * crashing. Mirrors the parse-don't-trust discipline in `wireAgentDeps`.
 */

const ClientMetaSchema = z.object({
  client_id: z.string().min(1),
  kid: z.string().min(1),
  scope: z.string().min(1),
});

export interface LoadClientOptions {
  readonly copilotRoot: string;
  readonly openemrBaseUrl: string;
  readonly openemrFetch: (url: string, init?: RequestInit) => Promise<Response>;
}

export async function loadOpenEmrFhirClient(
  options: LoadClientOptions,
): Promise<OpenEmrFhirClient | null> {
  const secretsDir = resolve(options.copilotRoot, ".secrets");

  let meta: z.infer<typeof ClientMetaSchema>;
  let pem: string;
  try {
    const rawMeta: unknown = JSON.parse(await readFile(resolve(secretsDir, "openemr-client.json"), "utf8"));
    meta = ClientMetaSchema.parse(rawMeta);
    pem = await readFile(resolve(secretsDir, "openemr-private-key.pem"), "utf8");
  } catch {
    return null;
  }

  const privateKey = await importRs384PrivateKey(pem);
  const scope = meta.scope
    .split(" ")
    .filter((s) => s !== "openid")
    .join(" ");

  const tokens = new OpenEmrTokenClient({
    baseUrl: options.openemrBaseUrl,
    clientId: meta.client_id,
    privateKey,
    scope,
    kid: meta.kid,
    fetchFn: options.openemrFetch,
  });
  return new OpenEmrFhirClient({
    baseUrl: options.openemrBaseUrl,
    getAccessToken: () => tokens.getAccessToken(),
    fetchFn: options.openemrFetch,
  });
}
