import { describe, it, expect, vi } from "vitest";
import { generateKeyPair } from "jose";
import { OpenEmrTokenClient } from "../src/oauth/token.js";

function jsonResponse(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const OK_TOKEN = { token_type: "Bearer", expires_in: 60, access_token: "AT-1", scope: "system/Patient.read" };

// One RS384 keypair for the whole suite. Generating a fresh RSA key per test is CPU-expensive and,
// under the full parallel suite's contention, occasionally exceeds vitest's timeout — a flaky push
// blocker. These tests exercise the token client, not key generation, so a single shared key is fine.
const { privateKey } = await generateKeyPair("RS384");

describe("OpenEmrTokenClient", () => {
  it("requests a token with client_credentials + jwt-bearer assertion and returns it", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(OK_TOKEN));
    const client = new OpenEmrTokenClient({
      baseUrl: "https://oe.test",
      clientId: "c",
      privateKey,
      scope: "system/Patient.read",
      fetchFn,
    });

    const token = await client.getAccessToken();
    expect(token).toBe("AT-1");

    const call = fetchFn.mock.calls[0]!;
    expect(call[0]).toBe("https://oe.test/oauth2/default/token");
    const body = call[1]!.body as URLSearchParams;
    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("client_assertion_type")).toBe(
      "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    );
    expect(body.get("client_assertion")).toBeTruthy();
    expect(body.get("scope")).toBe("system/Patient.read");
  });

  it("caches within the token lifetime and re-fetches after it expires", async () => {
    let n = 0;
    const fetchFn = vi.fn(async () =>
      jsonResponse({ token_type: "Bearer", expires_in: 60, access_token: `AT-${++n}` }),
    );
    let clock = new Date("2026-07-08T12:00:00Z");
    const client = new OpenEmrTokenClient({
      baseUrl: "https://oe.test",
      clientId: "c",
      privateKey,
      scope: "s",
      fetchFn,
      now: () => clock,
    });

    expect(await client.getAccessToken()).toBe("AT-1");
    clock = new Date("2026-07-08T12:00:30Z"); // still within 60s
    expect(await client.getAccessToken()).toBe("AT-1");
    expect(fetchFn).toHaveBeenCalledTimes(1);

    clock = new Date("2026-07-08T12:01:05Z"); // past expiry
    expect(await client.getAccessToken()).toBe("AT-2");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("throws a typed error without leaking server text on non-2xx", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ error: "invalid_client", error_description: "secret internal detail" }, 401),
    );
    const client = new OpenEmrTokenClient({
      baseUrl: "https://oe.test",
      clientId: "c",
      privateKey,
      scope: "s",
      fetchFn,
    });

    await expect(client.getAccessToken()).rejects.toThrow(/token request failed/i);
    await expect(client.getAccessToken()).rejects.not.toThrow(/secret internal detail/);
  });
});
