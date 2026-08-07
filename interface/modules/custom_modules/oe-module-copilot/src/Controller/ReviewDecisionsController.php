<?php

/**
 * Per-document review-decisions read endpoint — returns each extracted value's saved disposition
 * (accepted / discarded + the decided value) for one document, so the review UI shows committed vs
 * dismissed state on reopen (Week 2 review workflow). Read-only, in-session, ownership-scoped.
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
use OpenEMR\Common\Database\QueryUtils;
use OpenEMR\Common\Session\SessionWrapperFactory;
use OpenEMR\Common\Uuid\UuidRegistry;
use OpenEMR\Modules\Copilot\Ingestion\ReviewDecisionStore;
use OpenEMR\Modules\Copilot\Service\PanelService;

final class ReviewDecisionsController
{
    private readonly PanelService $panel;
    private readonly ReviewDecisionStore $decisions;

    public function __construct(?PanelService $panel = null, ?ReviewDecisionStore $decisions = null)
    {
        $this->panel = $panel ?? new PanelService();
        $this->decisions = $decisions ?? new ReviewDecisionStore();
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
        if (!AclMain::aclCheckCore('patients', 'demo')) {
            $this->fail(403, 'not authorized');
            return;
        }

        $rawId = filter_input(INPUT_GET, 'documentId');
        $document = $this->resolveDocument(is_string($rawId) ? $rawId : '');
        if ($document === null || $this->panel->ownedPatientFhirId($userId, $document['pid']) === null) {
            $this->fail(403, 'that document is not for a patient on your panel');
            return;
        }

        echo json_encode(
            ['decisions' => $this->decisions->decisionsForDocument($document['id'])],
            JSON_THROW_ON_ERROR
        );
    }

    /**
     * Resolve a FHIR DocumentReference id to the local `documents` row — `{id, pid}` — or null.
     *
     * @return array{id:int, pid:int}|null
     */
    private function resolveDocument(string $fhirId): ?array
    {
        if ($fhirId === '') {
            return null;
        }
        try {
            $uuidBytes = UuidRegistry::uuidToBytes($fhirId);
        } catch (\Throwable $e) {
            return null;
        }
        $row = QueryUtils::querySingleRow(
            'SELECT id, foreign_id FROM documents WHERE uuid = ? AND deleted = 0',
            [$uuidBytes]
        );
        if (!is_array($row)) {
            return null;
        }
        $id = is_numeric($row['id'] ?? null) ? (int) $row['id'] : 0;
        $pid = is_numeric($row['foreign_id'] ?? null) ? (int) $row['foreign_id'] : 0;
        if ($id <= 0 || $pid <= 0) {
            return null;
        }
        return ['id' => $id, 'pid' => $pid];
    }

    private function fail(int $status, string $message): void
    {
        http_response_code($status);
        echo json_encode(['error' => $message], JSON_THROW_ON_ERROR);
    }
}
