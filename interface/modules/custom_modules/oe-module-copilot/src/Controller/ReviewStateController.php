<?php

/**
 * Review-state read endpoint — returns the FHIR ids of the documents this provider has fully
 * reviewed for a patient (Week 2 review workflow). The chart widget subtracts these from the agent's
 * detected documents so the "Review Documents" launcher hides once everything has been dispositioned.
 * Read-only, in-session, ownership-scoped — the sidecar never reaches this code.
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

final class ReviewStateController
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

        // The patient is checked against the provider's panel — a non-owned pid is refused, never
        // partially answered (authorization-and-pid-scope).
        $pid = (int) (filter_input(INPUT_GET, 'pid', FILTER_VALIDATE_INT) ?: 0);
        if ($pid <= 0 || $this->panel->ownedPatientFhirId($userId, $pid) === null) {
            $this->fail(403, 'that patient is not on your panel');
            return;
        }

        $docs = $this->reviewedDocuments($this->decisions->reviewedDocumentIds($pid));
        echo json_encode(
            [
                // ids: the launcher subtracts these from detected to size the badge.
                'reviewedDocumentIds' => array_map(static fn(array $d): string => $d['documentId'], $docs),
                // full: name + date for the "Reviewed documents" revisit list.
                'reviewedDocuments' => $docs,
            ],
            JSON_THROW_ON_ERROR
        );
    }

    /**
     * The provider's reviewed documents for this patient — FHIR id + name + date — for the revisit list.
     *
     * @param list<int> $documentIds
     * @return list<array{documentId:string, name:string, date:string}>
     */
    private function reviewedDocuments(array $documentIds): array
    {
        if ($documentIds === []) {
            return [];
        }
        $placeholders = implode(',', array_fill(0, count($documentIds), '?'));
        $rows = QueryUtils::fetchRecords(
            "SELECT uuid, name, date FROM documents WHERE id IN ($placeholders) AND deleted = 0 ORDER BY date DESC",
            $documentIds
        );
        $out = [];
        foreach ($rows as $row) {
            $uuid = $row['uuid'] ?? null;
            if (!is_string($uuid) || $uuid === '') {
                continue;
            }
            $name = $row['name'] ?? null;
            $date = $row['date'] ?? null;
            $out[] = [
                'documentId' => UuidRegistry::uuidToString($uuid),
                'name' => is_string($name) ? $name : '',
                'date' => is_string($date) ? substr($date, 0, 10) : '',
            ];
        }
        return $out;
    }

    private function fail(int $status, string $message): void
    {
        http_response_code($status);
        echo json_encode(['error' => $message], JSON_THROW_ON_ERROR);
    }
}
