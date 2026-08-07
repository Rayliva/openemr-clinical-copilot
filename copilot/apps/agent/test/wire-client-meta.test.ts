import { describe, it, expect } from "vitest";
import { ClientMetaSchema } from "../src/agent/wire.js";

/**
 * Regression: a `.strict()` schema here rejected the real openemr-client.json (which
 * carries extra keys like `base_url` from the OAuth registration), so wireAgentDeps
 * returned null and /chat silently failed to register in prod. The schema must validate
 * the required fields and TOLERATE extras.
 */
describe("ClientMetaSchema", () => {
  it("accepts a client meta with extra keys (e.g. base_url) — the real file shape", () => {
    const raw = {
      client_id: "abc",
      kid: "kid-1",
      scope: "system/Patient.read",
      base_url: "https://localhost:9300",
    };
    const parsed = ClientMetaSchema.parse(raw);
    expect(parsed).toMatchObject({ client_id: "abc", kid: "kid-1", scope: "system/Patient.read" });
  });

  it("still rejects a meta missing a required field", () => {
    expect(() => ClientMetaSchema.parse({ kid: "k", scope: "s" })).toThrow();
    expect(() => ClientMetaSchema.parse({ client_id: "", kid: "k", scope: "s" })).toThrow();
  });
});
