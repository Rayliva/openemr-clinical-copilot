import { describe, expect, it } from "vitest";
import { verifySessionToken, type SessionTokenPayload } from "../src/index.js";

/**
 * Cross-language contract guard. The token below was minted by the PHP bridge
 * (`oe-module-copilot` `SessionTokenMinter`) for a fixed payload + secret. It must
 * verify with this TS verifier — proving the two HMAC implementations agree on the
 * wire format (header, snake_case payload, unpadded base64url, HS256 signing input).
 *
 * To regenerate after a format change, re-run the PHP minter with the same payload:
 *   php -r 'require ".../SessionTokenMinter.php";
 *     echo (new OpenEMR\Modules\Copilot\Service\SessionTokenMinter("golden-secret-123"))
 *       ->mint(["user_id"=>6,"pid"=>1,"patient_fhir_id"=>"a2326abc-c03c-4b9e-8af9-b7e03a9b4362",
 *               "correlation_id"=>"corr-golden","exp"=>4102444800]);'
 */
const PHP_MINTED_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
  "eyJ1c2VyX2lkIjo2LCJwaWQiOjEsInBhdGllbnRfZmhpcl9pZCI6ImEyMzI2YWJjLWMwM2MtNGI5ZS04YWY5LWI3ZTAzYTliNDM2MiIsImNvcnJlbGF0aW9uX2lkIjoiY29yci1nb2xkZW4iLCJleHAiOjQxMDI0NDQ4MDB9." +
  "g3tYCoDWJNp7ZozRaIhXdyvLhhlWh7lPB52g4A6LVNQ";

const SECRET = "golden-secret-123";
const NOW = 1_800_000_000; // before the token's exp (4102444800)

const EXPECTED: SessionTokenPayload = {
  userId: 6,
  pid: 1,
  patientFhirId: "a2326abc-c03c-4b9e-8af9-b7e03a9b4362",
  correlationId: "corr-golden",
  exp: 4_102_444_800,
};

describe("PHP <-> TS session-token parity (golden vector)", () => {
  it("verifies a token minted by the PHP oe-module-copilot bridge", () => {
    const result = verifySessionToken(PHP_MINTED_TOKEN, SECRET, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload).toEqual(EXPECTED);
    }
  });

  it("rejects the PHP-minted token under the wrong secret", () => {
    expect(verifySessionToken(PHP_MINTED_TOKEN, "wrong-secret", NOW)).toEqual({
      ok: false,
      reason: "bad-signature",
    });
  });

  // The same PHP payload + `"subject":"system:ingest"` appended last. Proves the subject claim is
  // byte-compatible across PHP + TS (the confined system-ingest token, Part C of auto-ingest).
  //   php -r '... ->mint([...,"subject"=>"system:ingest"]);'
  it("verifies a PHP-minted system:ingest token (subject appended last)", () => {
    const phpSystemToken =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
      "eyJ1c2VyX2lkIjo2LCJwaWQiOjEsInBhdGllbnRfZmhpcl9pZCI6ImEyMzI2YWJjLWMwM2MtNGI5ZS04YWY5LWI3ZTAzYTliNDM2MiIsImNvcnJlbGF0aW9uX2lkIjoiY29yci1nb2xkZW4iLCJleHAiOjQxMDI0NDQ4MDAsInN1YmplY3QiOiJzeXN0ZW06aW5nZXN0In0." +
      "yNU9Cs1mTZhl0a2NKQMp48Yu1vFoNu9dmK0BTDep1AQ";
    const result = verifySessionToken(phpSystemToken, SECRET, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload).toEqual({ ...EXPECTED, subject: "system:ingest" });
    }
  });
});
