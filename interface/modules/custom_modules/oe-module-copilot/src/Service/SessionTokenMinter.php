<?php

/**
 * Session-token minter (boundary #1).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    Raych
 * @copyright Copyright (c) 2026 Raych
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\Copilot\Service;

/**
 * Mints the HMAC-signed session token the sidecar agent verifies on every request.
 *
 * The wire format is byte-compatible with the agent's `@copilot/session-token`
 * verifier: a compact `base64url(header).base64url(payload).sig` string, HS256 over
 * the signing input, header `{"alg":"HS256","typ":"JWT"}`, snake_case payload
 * `{user_id, pid, patient_fhir_id, correlation_id, exp}`. base64url is unpadded, to
 * match Node's `Buffer.toString('base64url')`. Kept dependency-free (no OpenEMR
 * globals) so it is unit-testable in isolation and cannot leak the secret.
 */
final class SessionTokenMinter
{
    public function __construct(private readonly string $secret)
    {
        if ($this->secret === '') {
            throw new \DomainException('bridge secret is not configured');
        }
    }

    /**
     * @param array{user_id:int, pid:int, patient_fhir_id:string, correlation_id:string, exp:int, subject?:string} $payload
     */
    public function mint(array $payload): string
    {
        $header = ['alg' => 'HS256', 'typ' => 'JWT'];
        $signingInput = self::base64UrlEncode($this->encodeJson($header))
            . '.' . self::base64UrlEncode($this->encodeJson($payload));
        $signature = self::base64UrlEncode(hash_hmac('sha256', $signingInput, $this->secret, true));

        return $signingInput . '.' . $signature;
    }

    /**
     * @param array<string, mixed> $value
     */
    private function encodeJson(array $value): string
    {
        return json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
    }

    private static function base64UrlEncode(string $binary): string
    {
        return rtrim(strtr(base64_encode($binary), '+/', '-_'), '=');
    }
}
