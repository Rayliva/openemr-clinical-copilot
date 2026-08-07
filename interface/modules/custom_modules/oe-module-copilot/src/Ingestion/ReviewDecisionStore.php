<?php

/**
 * Persists the physician's per-value review decisions + a per-document reviewed flag (Week 2 review
 * workflow). This is the module's own review state — NOT chart truth. Accepted values still become
 * Observations via {@see DerivedObservationWriter} (the chart source of truth); this store only
 * remembers the DECISION (so a discard is not forgotten and a reviewed document stops nagging).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    Raych
 * @copyright Copyright (c) 2026 Raych
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\Copilot\Ingestion;

use OpenEMR\Common\Database\QueryUtils;

/**
 * Upserts one live disposition per (document, value_key) and derives the document's reviewed flag
 * from whether the physician left anything undecided. Backed by the `copilot_review_decision` +
 * `copilot_document_review` tables (see `scripts/install_review_schema.php`).
 */
final class ReviewDecisionStore
{
    /**
     * Record every accepted + discarded decision for one reviewed document, and set the document's
     * reviewed flag (reviewed ⇔ no value was left undecided this commit). Upserts, so a re-review
     * overwrites the prior disposition rather than duplicating it.
     */
    public function record(int $documentId, int $pid, int $userId, ReviewCommitRequest $request, string $now): void
    {
        foreach ($request->acceptedValues as $value) {
            $this->upsertDecision($documentId, $value->valueKey(), 'accepted', $value->value, $userId, $now);
        }
        foreach ($request->discardedValues as $value) {
            $this->upsertDecision($documentId, $value->valueKey(), 'discarded', $value->value, $userId, $now);
        }
        $this->setReviewed($documentId, $pid, !$request->hasUndecided, $userId, $now);
    }

    private function upsertDecision(
        int $documentId,
        string $valueKey,
        string $disposition,
        string $decidedValue,
        int $userId,
        string $now,
    ): void {
        QueryUtils::sqlStatementThrowException(
            'INSERT INTO copilot_review_decision'
            . ' (document_id, value_key, disposition, decided_value, user_id, updated_at)'
            . ' VALUES (?, ?, ?, ?, ?, ?)'
            . ' ON DUPLICATE KEY UPDATE'
            . ' disposition = VALUES(disposition), decided_value = VALUES(decided_value),'
            . ' user_id = VALUES(user_id), updated_at = VALUES(updated_at)',
            [$documentId, $valueKey, $disposition, $decidedValue, $userId, $now]
        );
    }

    private function setReviewed(int $documentId, int $pid, bool $reviewed, int $userId, string $now): void
    {
        QueryUtils::sqlStatementThrowException(
            'INSERT INTO copilot_document_review (document_id, pid, reviewed, user_id, updated_at)'
            . ' VALUES (?, ?, ?, ?, ?)'
            . ' ON DUPLICATE KEY UPDATE'
            . ' reviewed = VALUES(reviewed), user_id = VALUES(user_id), updated_at = VALUES(updated_at)',
            [$documentId, $pid, $reviewed ? 1 : 0, $userId, $now]
        );
    }

    /**
     * The local `documents.id`s the physician has fully reviewed for this patient — the launcher
     * subtracts these from the detected documents so a reviewed document stops showing (Slice 3).
     *
     * @return list<int>
     */
    public function reviewedDocumentIds(int $pid): array
    {
        $rows = QueryUtils::fetchRecords(
            'SELECT document_id FROM copilot_document_review WHERE pid = ? AND reviewed = 1',
            [$pid]
        );
        $ids = [];
        foreach ($rows as $row) {
            $id = $row['document_id'] ?? null;
            if (is_numeric($id)) {
                $ids[] = (int) $id;
            }
        }
        return $ids;
    }

    /**
     * Each recorded value's disposition for one document, keyed by value_key — the review UI uses it
     * on reopen to show committed / dismissed state (Slice 4).
     *
     * @return array<string, array{disposition: string, value: string}>
     */
    public function decisionsForDocument(int $documentId): array
    {
        $rows = QueryUtils::fetchRecords(
            'SELECT value_key, disposition, decided_value FROM copilot_review_decision WHERE document_id = ?',
            [$documentId]
        );
        $out = [];
        foreach ($rows as $row) {
            $key = $row['value_key'] ?? null;
            if (!is_string($key) || $key === '') {
                continue;
            }
            $disposition = $row['disposition'] ?? null;
            $decidedValue = $row['decided_value'] ?? null;
            $out[$key] = [
                'disposition' => is_string($disposition) ? $disposition : '',
                'value' => is_string($decidedValue) ? $decidedValue : '',
            ];
        }
        return $out;
    }
}
