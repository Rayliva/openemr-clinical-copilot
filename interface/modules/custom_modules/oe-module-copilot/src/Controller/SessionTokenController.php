<?php

/**
 * Mint endpoint controller — GET /copilot/session-token equivalent.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    Raych
 * @copyright Copyright (c) 2026 Raych
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\Copilot\Controller;

use OpenEMR\Common\Acl\AclMain;
use OpenEMR\Common\Csrf\CsrfUtils;
use OpenEMR\Common\Session\SessionWrapperFactory;
use OpenEMR\Modules\Copilot\Service\PanelService;
use OpenEMR\Modules\Copilot\Service\SessionTokenMinter;

/**
 * For the currently authenticated OpenEMR user, mints a session token bound to a
 * single pid the user owns. Ownership is enforced here (row-level), the one control
 * compensating for OpenEMR's role-level API token (AUDIT.md §1.1). A request for a
 * non-owned pid is refused (403) — never partially served.
 */
final class SessionTokenController
{
    /** Short-lived: re-mint on expiry rather than refresh (spec increment B). */
    private const TTL_SECONDS = 300;

    private readonly PanelService $panel;

    public function __construct(?PanelService $panel = null)
    {
        $this->panel = $panel ?? new PanelService();
    }

    public function handle(): void
    {
        header('Content-Type: application/json');

        $session = SessionWrapperFactory::getInstance()->getActiveSession();
        $userIdValue = $session->get('authUserID');
        $userId = is_numeric($userIdValue) ? (int) $userIdValue : 0;
        if ($userId <= 0) {
            $this->fail(401, 'not authenticated');
            return;
        }

        // Enforce the module's declared ACL (not just authentication + ownership).
        if (!AclMain::aclCheckCore('patients', 'demo')) {
            $this->fail(403, 'not authorized');
            return;
        }

        // Superglobals are parsed at the edge via filter_input (project rule forbids
        // direct $_GET/$_POST). Minting is a state-changing request, so it is POST and
        // the CSRF token + pid travel in the body (never the URL/logs/history).
        $csrfToken = filter_input(INPUT_POST, 'csrf_token_form');
        if (!is_string($csrfToken) || !CsrfUtils::verifyCsrfToken($csrfToken, session: $session)) {
            $this->fail(403, 'csrf verification failed');
            return;
        }

        $pidInput = filter_input(INPUT_POST, 'pid', FILTER_VALIDATE_INT);
        $pid = is_int($pidInput) ? $pidInput : 0;
        if ($pid <= 0) {
            $this->fail(400, 'pid is required');
            return;
        }

        $secret = (string) (getenv('COPILOT_BRIDGE_SECRET') ?: '');
        if ($secret === '') {
            // Fail closed, and don't leak that the secret is the missing piece.
            $this->fail(503, 'token minting is unavailable');
            return;
        }

        // Ownership gate: only ever mint for a patient on this provider's panel.
        $patientFhirId = $this->panel->ownedPatientFhirId($userId, $pid);
        if ($patientFhirId === null) {
            $this->fail(403, 'that patient is not on your panel');
            return;
        }

        $token = (new SessionTokenMinter($secret))->mint([
            'user_id' => $userId,
            'pid' => $pid,
            'patient_fhir_id' => $patientFhirId,
            'correlation_id' => $this->newCorrelationId(),
            'exp' => time() + self::TTL_SECONDS,
        ]);

        echo json_encode(
            ['token' => $token, 'patient_fhir_id' => $patientFhirId],
            JSON_THROW_ON_ERROR
        );
    }

    /** RFC 4122 v4 UUID for the correlation id (threads logs/tools/LLM at the agent). */
    private function newCorrelationId(): string
    {
        $bytes = random_bytes(16);
        $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
        $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
        $hex = bin2hex($bytes);

        return sprintf(
            '%s-%s-%s-%s-%s',
            substr($hex, 0, 8),
            substr($hex, 8, 4),
            substr($hex, 12, 4),
            substr($hex, 16, 4),
            substr($hex, 20, 12)
        );
    }

    private function fail(int $status, string $message): void
    {
        http_response_code($status);
        echo json_encode(['error' => $message], JSON_THROW_ON_ERROR);
    }
}
