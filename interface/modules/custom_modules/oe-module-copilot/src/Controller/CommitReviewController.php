<?php

/**
 * Commit-review endpoint controller — the ONLY write in the system (Week 2 slice 2f).
 * Persists the physician's accepted extracted values as FHIR-visible OpenEMR Observations.
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
use OpenEMR\Common\Database\QueryUtils;
use OpenEMR\Common\Session\SessionWrapperFactory;
use OpenEMR\Common\Uuid\UuidRegistry;
use OpenEMR\Modules\Copilot\Ingestion\DerivedObservationWriter;
use OpenEMR\Modules\Copilot\Ingestion\DerivedWriteContext;
use OpenEMR\Modules\Copilot\Ingestion\DerivedWriteRejected;
use OpenEMR\Modules\Copilot\Ingestion\DerivedWriteStatus;
use OpenEMR\Modules\Copilot\Ingestion\ReviewCommitRequest;
use OpenEMR\Modules\Copilot\Ingestion\ReviewDecisionStore;
use OpenEMR\Modules\Copilot\Service\PanelService;
use OpenEMR\Services\ObservationService;

/**
 * Receives the physician's per-value accept/edit decisions for one reviewed document and writes the
 * accepted values to the chart. Every gate holds here: authenticated session, module ACL, CSRF,
 * row-level ownership of the document's patient (re-checked at the write boundary), and — in
 * DerivedObservationWriter — the citation gate + idempotency. The sidecar never reaches this code;
 * only an in-session OpenEMR request does. Returns a per-value result so the UI shows what was
 * written / skipped-as-duplicate / rejected.
 */
final class CommitReviewController
{
    private readonly PanelService $panel;
    private readonly DerivedObservationWriter $writer;
    private readonly ReviewDecisionStore $decisions;

    public function __construct(
        ?PanelService $panel = null,
        ?DerivedObservationWriter $writer = null,
        ?ReviewDecisionStore $decisions = null,
    ) {
        $this->panel = $panel ?? new PanelService();
        $this->writer = $writer ?? new DerivedObservationWriter(new ObservationService());
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

        // The review UI POSTs a JSON body {csrf_token_form, documentId, values:[...]}.
        $raw = file_get_contents('php://input');
        $body = is_string($raw) && $raw !== '' ? json_decode($raw, true) : null;
        if (!is_array($body)) {
            $this->fail(400, 'invalid request body');
            return;
        }
        $csrf = $body['csrf_token_form'] ?? null;
        if (!is_string($csrf) || !CsrfUtils::verifyCsrfToken($csrf, session: $session)) {
            $this->fail(403, 'csrf verification failed');
            return;
        }

        try {
            $request = ReviewCommitRequest::fromDecodedJson($body);
        } catch (\InvalidArgumentException $e) {
            $this->fail(400, 'malformed review payload');
            return;
        }

        // Resolve the FHIR DocumentReference id to the local documents row (id + owning pid) and
        // re-check ownership at the write boundary — the pid is derived from the reviewed document,
        // never taken from the request.
        $document = $this->resolveDocument($request->documentFhirId);
        if ($document === null || $this->panel->ownedPatientFhirId($userId, $document['pid']) === null) {
            $this->fail(403, 'that document is not for a patient on your panel');
            return;
        }
        $pid = $document['pid'];

        // Group a document's values into ONE encounter form: reuse the document's existing form + its
        // encounter if it already has derived observations, else the first write creates the form and we
        // capture its id for the rest. Date the Observations by the document's collection date.
        $existingForm = $this->resolveDocumentForm((int) $document['id']);
        $encounterId = $existingForm !== null ? $existingForm['encounter'] : $this->resolveEncounter($pid);
        if ($encounterId <= 0) {
            $this->fail(409, 'no encounter available for this patient');
            return;
        }
        $formId = $existingForm !== null ? $existingForm['formId'] : 0;
        $observationDate = $this->resolveObservationDate($request->collectionDate);

        $authUser = $session->get('authUser');
        $authProvider = $session->get('authProvider');
        $user = is_string($authUser) ? $authUser : '';
        $groupname = is_string($authProvider) ? $authProvider : 'Default';

        $results = [];
        $written = 0;
        $superseded = 0;
        $skipped = 0;
        $rejected = 0;
        foreach ($request->acceptedValues as $value) {
            $ctx = new DerivedWriteContext(
                pid: $pid,
                documentId: (int) $document['id'],
                encounterId: $encounterId,
                user: $user,
                groupname: $groupname,
                date: $observationDate,
                labTypeOptionId: 'laboratory',
                formId: $formId,
            );
            try {
                $status = $this->writer->commit($value, $ctx);
                $key = match ($status) {
                    DerivedWriteStatus::Written => 'written',
                    DerivedWriteStatus::Superseded => 'superseded',
                    DerivedWriteStatus::SkippedDuplicate => 'skipped',
                };
                if ($status === DerivedWriteStatus::Written) {
                    $written++;
                } elseif ($status === DerivedWriteStatus::Superseded) {
                    $superseded++;
                } else {
                    $skipped++;
                }
                $results[] = ['testName' => $value->testName, 'status' => $key];
                // The first write to a fresh document created the shared form — capture it for the rest.
                if ($formId === 0) {
                    $created = $this->resolveDocumentForm((int) $document['id']);
                    if ($created !== null) {
                        $formId = $created['formId'];
                    }
                }
            } catch (DerivedWriteRejected $e) {
                $rejected++;
                $results[] = ['testName' => $value->testName, 'status' => 'rejected', 'reason' => $e->getMessage()];
            }
        }

        // Persist the physician's per-value dispositions + the document's reviewed flag. Secondary to
        // the chart write above: if it fails (e.g. the review tables are not installed) the Observations
        // still stand, so DEGRADE — log and report it, never 500 a commit that already wrote the chart.
        $discarded = count($request->discardedValues);
        $reviewed = !$request->hasUndecided;
        $decisionsRecorded = true;
        try {
            $this->decisions->record((int) $document['id'], $pid, $userId, $request, date('Y-m-d H:i:s'));
        } catch (\Throwable $e) {
            $decisionsRecorded = false;
            $reviewed = false;
            (new \OpenEMR\Common\Logging\SystemLogger())->error('copilot review-decision record failed', [
                'pid' => $pid,
                'documentId' => $document['id'],
            ]);
        }

        // Auditable write record (independent of OpenEMR's own log) — no PHI values, just counts.
        (new \OpenEMR\Common\Logging\SystemLogger())->info('copilot commit-review write', [
            'userId' => $userId,
            'pid' => $pid,
            'documentId' => $document['id'],
            'written' => $written,
            'superseded' => $superseded,
            'skipped' => $skipped,
            'rejected' => $rejected,
            'discarded' => $discarded,
            'reviewed' => $reviewed,
        ]);

        echo json_encode(
            [
                'written' => $written,
                'superseded' => $superseded,
                'skipped' => $skipped,
                'rejected' => $rejected,
                'discarded' => $discarded,
                'reviewed' => $reviewed,
                'decisionsRecorded' => $decisionsRecorded,
                'results' => $results,
            ],
            JSON_THROW_ON_ERROR
        );
    }

    /**
     * Resolve a FHIR DocumentReference id (the document's uuid) to the local `documents` row —
     * `{id, pid}` — or null if missing/deleted.
     *
     * @return array{id:int, pid:int}|null
     */
    private function resolveDocument(string $fhirId): ?array
    {
        // A malformed FHIR id must degrade to "not found" (→ 403 upstream), never an uncaught 500.
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

    /** The patient's most recent encounter id (derived observations attach to an encounter), or 0. */
    private function resolveEncounter(int $pid): int
    {
        $row = QueryUtils::querySingleRow(
            'SELECT encounter FROM form_encounter WHERE pid = ? ORDER BY date DESC, encounter DESC LIMIT 1',
            [$pid]
        );
        $enc = is_array($row) ? ($row['encounter'] ?? null) : null;
        return is_numeric($enc) ? (int) $enc : 0;
    }

    /**
     * The `form_id` + encounter of the document's existing derived observations (any row — the form
     * still exists even if a value was later voided), so all of a document's values group into ONE
     * form. Null when the document has no derived observations yet (the first write creates the form).
     *
     * @return array{formId:int, encounter:int}|null
     */
    private function resolveDocumentForm(int $documentId): ?array
    {
        $row = QueryUtils::querySingleRow(
            "SELECT form_id, encounter FROM form_observation"
            . " WHERE ob_documentationof_table = 'documents' AND ob_documentationof_table_id = ?"
            . ' ORDER BY id ASC LIMIT 1',
            [$documentId]
        );
        if (!is_array($row)) {
            return null;
        }
        $formId = is_numeric($row['form_id'] ?? null) ? (int) $row['form_id'] : 0;
        $encounter = is_numeric($row['encounter'] ?? null) ? (int) $row['encounter'] : 0;
        if ($formId <= 0 || $encounter <= 0) {
            return null;
        }
        return ['formId' => $formId, 'encounter' => $encounter];
    }

    /**
     * The document's collection date as `Y-m-d H:i:s` for dating the Observations; falls back to now
     * when the extraction gave no date or it does not parse (never write an invalid date).
     */
    private function resolveObservationDate(?string $collectionDate): string
    {
        if ($collectionDate !== null && trim($collectionDate) !== '') {
            $ts = strtotime($collectionDate);
            if ($ts !== false) {
                return date('Y-m-d H:i:s', $ts);
            }
        }
        return date('Y-m-d H:i:s');
    }

    private function fail(int $status, string $message): void
    {
        http_response_code($status);
        echo json_encode(['error' => $message], JSON_THROW_ON_ERROR);
    }
}
