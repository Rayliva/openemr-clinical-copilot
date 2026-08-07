import { importPKCS8 } from "jose";
import type { SigningKey } from "./assertion.js";

/**
 * Import a PEM (PKCS#8) private key for RS384 signing, so consumers of this
 * package never need to depend on `jose` directly.
 */
export function importRs384PrivateKey(pem: string): Promise<SigningKey> {
  return importPKCS8(pem, "RS384");
}
