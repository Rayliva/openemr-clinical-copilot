<?php

/**
 * Source-document resolver — maps a chat citation (a derived lab Observation) back to the source
 * document it was extracted from, so the chat can show the page screenshot + bounding box
 * (Week 2, w2-inline-source-viewer Slice B). READ-ONLY: resolves ids, never writes.
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
use OpenEMR\Modules\Copilot\Service\PanelService;

/**
 * Given a derived lab Observation's FHIR uuid (a chat citation's chart source ref), return the FHIR
 * id of the source `DocumentReference` it was `derivedFrom` (via the module write path's
 * `ob_documentationof_*` columns), IFF that document belongs to a patient on the requesting
 * clinician's panel. A value that was entered directly (no source document) resolves to
 * `{found:false}` — the chat then shows no "view source" button. The pid is never taken from the
 * request; it is derived from the resolved document and re-checked for ownership.
 */
final class SourceDocumentController
{
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
        if (!AclMain::aclCheckCore('patients', 'demo')) {
            $this->fail(403, 'not authorized');
            return;
        }

        $observationFhirId = $_GET['observation'] ?? null;
        if (!is_string($observationFhirId) || $observationFhirId === '') {
            $this->fail(400, 'observation id required');
            return;
        }

        $resolved = $this->resolve($observationFhirId);
        if ($resolved === null) {
            // Not derived from a document (directly entered), or missing — NOT an error, just "no source".
            echo json_encode(['found' => false], JSON_THROW_ON_ERROR);
            return;
        }

        // Ownership: the document's patient must be on this clinician's panel. Never trust the request.
        if ($this->panel->ownedPatientFhirId($userId, $resolved['pid']) === null) {
            $this->fail(403, 'that source is not for a patient on your panel');
            return;
        }

        echo json_encode(
            ['found' => true, 'documentFhirId' => $resolved['documentFhirId'], 'value' => $resolved['value']],
            JSON_THROW_ON_ERROR
        );
    }

    /**
     * Resolve a derived Observation uuid → its source document's {FHIR id, owning pid, value}, or null
     * when the observation is missing, malformed, or not document-derived.
     *
     * @return array{documentFhirId:string, pid:int, value:string}|null
     */
    private function resolve(string $observationFhirId): ?array
    {
        // A malformed uuid degrades to "no source", never an uncaught 500.
        try {
            $obsBytes = UuidRegistry::uuidToBytes($observationFhirId);
        } catch (\Throwable $e) {
            return null;
        }

        // The write path stamps ob_documentationof_table='documents' + the source documents.id.
        $obs = QueryUtils::querySingleRow(
            "SELECT ob_documentationof_table_id AS doc_id, ob_value AS value FROM form_observation"
            . " WHERE uuid = ? AND ob_documentationof_table = 'documents' LIMIT 1",
            [$obsBytes]
        );
        if (!is_array($obs)) {
            return null;
        }
        $docId = is_numeric($obs['doc_id'] ?? null) ? (int) $obs['doc_id'] : 0;
        if ($docId <= 0) {
            return null;
        }

        $doc = QueryUtils::querySingleRow(
            'SELECT uuid, foreign_id FROM documents WHERE id = ? AND deleted = 0',
            [$docId]
        );
        if (!is_array($doc)) {
            return null;
        }
        $pid = is_numeric($doc['foreign_id'] ?? null) ? (int) $doc['foreign_id'] : 0;
        $uuidRaw = $doc['uuid'] ?? null;
        if ($pid <= 0 || !is_string($uuidRaw) || $uuidRaw === '') {
            return null;
        }

        return [
            'documentFhirId' => UuidRegistry::uuidToString($uuidRaw),
            'pid' => $pid,
            'value' => is_scalar($obs['value'] ?? null) ? (string) $obs['value'] : '',
        ];
    }

    private function fail(int $status, string $message): void
    {
        http_response_code($status);
        echo json_encode(['error' => $message], JSON_THROW_ON_ERROR);
    }
}
