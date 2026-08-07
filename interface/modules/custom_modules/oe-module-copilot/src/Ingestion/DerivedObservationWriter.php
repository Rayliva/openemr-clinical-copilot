<?php

/**
 * Persists a physician-confirmed extracted value as a FHIR-visible OpenEMR Observation (Week 2
 * write path, 2f). The ONLY write in the system — see `.claude/rules/w2-document-ingestion-writes.md`
 * and `copilot/docs/specs/w2-ingest-write-path.md`.
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
use OpenEMR\Services\ObservationService;

/**
 * Maps a ConfirmedValue → an `ObservationService::saveObservation()` payload and commits it, once.
 *
 * Two responsibilities, split for testability (mirrors PanelService's pure/DB split):
 *  - {@see buildPayload()} is PURE (no DB, no OpenEMR services) so the safety gates + provenance
 *    mapping are unit-testable in isolation. It enforces write-path gate #2 (citation present unless
 *    the value was physician-corrected) and stamps co-pilot provenance + the `derivedFrom` link.
 *  - {@see commit()} adds the idempotency guard (same document+code+value already written → no-op,
 *    no duplicate) and the actual `saveObservation` insert, in the physician's session.
 *
 * Gate #1 (physician confirm) is upstream — the endpoint builds a ConfirmedValue only for accepted
 * rows. Gate #3 (module writes, not the sidecar) is structural — this class lives in the module.
 */
final class DerivedObservationWriter
{
    /** FHIR Observation status marking a superseded (revised-away) value — voided, not deleted. */
    private const VOID_STATUS = 'entered-in-error';

    public function __construct(private readonly ObservationService $observationService)
    {
    }

    /**
     * Decide what to do with a physician-accepted value given the ACTIVE (non-voided) derived rows
     * already on the chart for this (document, code): a matching value is a no-op ('skip'); a
     * DIFFERENT active value means the physician revised it ('supersede'); none means a fresh
     * 'write'. Pure — the DB read/write happens in {@see commit()}.
     *
     * @param list<array{ob_value?: mixed}> $activeRows
     * @return 'skip'|'supersede'|'write'
     */
    public static function decide(array $activeRows, string $newValue): string
    {
        foreach ($activeRows as $row) {
            $obValue = $row['ob_value'] ?? '';
            if (is_scalar($obValue) && (string) $obValue === $newValue) {
                return 'skip';
            }
        }
        return $activeRows === [] ? 'write' : 'supersede';
    }

    /**
     * Build the `saveObservation` payload for one confirmed value, enforcing the write-path gates.
     * Pure + total: no DB, no clock, no IO. Throws {@see DerivedWriteRejected} when a gate fails.
     *
     * @return array<string, string|int>
     */
    public static function buildPayload(ConfirmedValue $value, DerivedWriteContext $ctx): array
    {
        if (trim($value->value) === '') {
            throw new DerivedWriteRejected('cannot write an empty value');
        }
        $hasCitation = trim($value->citationId) !== '';
        // Gate #2: no box-match citation is only writable when the physician edited/confirmed the
        // value — otherwise it is a forced-review item, never a silent uncited fill.
        if (!$hasCitation && !$value->physicianCorrected) {
            throw new DerivedWriteRejected('value has no citation and was not physician-corrected');
        }

        // The DESCRIPTION is the clean clinical label the physician sees in OpenEMR's native
        // Observation form — it must be just the analyte name ("Hemoglobin"), NOT internal metadata.
        // The provenance (co-pilot-derived, source document, citation / physician-confirmed-without-box,
        // physician-correction, reference range) goes into the `observation` column, which the form
        // renders as its (previously empty) "Comments" field — a proper, non-cluttering home. The
        // idempotency key is `ob_documentationof_table_id` + `code` + `ob_value` (see decide()/commit()),
        // NOT the description text, so moving the annotation out changes nothing about dedup.
        $provenance = 'co-pilot-derived from document #' . $ctx->documentId;
        if ($value->physicianCorrected) {
            $provenance .= ', physician-corrected';
        }
        $provenance .= $hasCitation ? ', citation ' . $value->citationId : ', no page box — physician-confirmed';
        if ($value->referenceRange !== null && trim($value->referenceRange) !== '') {
            $provenance .= ' (ref ' . $value->referenceRange . ')';
        }

        return [
            'pid' => $ctx->pid,
            'encounter' => $ctx->encounterId,
            'user' => $ctx->user,
            'groupname' => $ctx->groupname,
            'date' => $ctx->date,
            'code' => ValueKey::of($value->loinc, $value->testName),
            'description' => $value->testName,
            'observation' => $provenance,
            'ob_value' => $value->value,
            'ob_unit' => $value->unit ?? '',
            'ob_status' => 'final',
            'ob_type' => $ctx->labTypeOptionId,
            'category' => 'laboratory',
            // The derivedFrom link to the source document (idempotency anchor + provenance).
            'ob_documentationof_table' => 'documents',
            'ob_documentationof_table_id' => $ctx->documentId,
        ];
    }

    /**
     * Persist one confirmed value, idempotently. Re-committing the same document+code+value is a
     * no-op (no duplicate Observation, no silent overwrite). Returns whether the row was written or
     * skipped as an existing duplicate; a gate failure propagates as {@see DerivedWriteRejected}.
     */
    public function commit(ConfirmedValue $value, DerivedWriteContext $ctx): DerivedWriteStatus
    {
        $payload = self::buildPayload($value, $ctx);
        $newValue = (string) $payload['ob_value'];

        // The ACTIVE (non-voided) derived rows already on the chart for this (document, code).
        $active = QueryUtils::fetchRecords(
            'SELECT id, ob_value FROM form_observation'
            . ' WHERE ob_documentationof_table = ? AND ob_documentationof_table_id = ?'
            . ' AND code = ? AND (ob_status IS NULL OR ob_status <> ?)',
            ['documents', $ctx->documentId, $payload['code'], self::VOID_STATUS]
        );

        $decision = self::decide($active, $newValue);
        if ($decision === 'skip') {
            return DerivedWriteStatus::SkippedDuplicate; // same value already on the chart → no-op
        }

        // A revised value → void the prior active row(s) first (auditable: entered-in-error, NOT
        // deleted), so exactly one active Observation remains for this (document, code) — no duplicate,
        // no silent overwrite.
        if ($decision === 'supersede') {
            foreach ($active as $row) {
                $priorId = is_numeric($row['id'] ?? null) ? (int) $row['id'] : 0;
                if ($priorId > 0) {
                    QueryUtils::sqlStatementThrowException(
                        'UPDATE form_observation SET ob_status = ? WHERE id = ?',
                        [self::VOID_STATUS, $priorId]
                    );
                }
            }
        }

        // Join the document's shared form so all its values group into ONE encounter entry (a new or
        // superseding value uses the same form_id). 0 → saveObservation creates + attaches a new form.
        if ($ctx->formId > 0) {
            $payload['form_id'] = $ctx->formId;
        }

        // ObservationService::saveObservation does NOT persist the ob_documentationof_* columns, so set
        // the derivedFrom link (source document) on the saved row directly — it is also the key the
        // active-row lookup above uses, so it must be present for a later re-commit to reconcile.
        $saved = $this->observationService->saveObservation($payload);
        // OpenEMR's DB layer returns ids as strings ("42"), so accept a numeric id (int OR string).
        $savedIdRaw = $saved['id'] ?? null;
        $savedId = is_numeric($savedIdRaw) ? (int) $savedIdRaw : 0;
        if ($savedId > 0) {
            QueryUtils::sqlStatementThrowException(
                'UPDATE form_observation SET ob_documentationof_table = ?, ob_documentationof_table_id = ? WHERE id = ?',
                ['documents', $ctx->documentId, $savedId]
            );
        }
        return $decision === 'supersede' ? DerivedWriteStatus::Superseded : DerivedWriteStatus::Written;
    }
}
