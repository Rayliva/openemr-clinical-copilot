<?php

/**
 * Write-path gate unit tests (Week 2 slice 2f) — the pure core of the ONLY write in the system.
 * Regression guard: a value with no citation must NOT be written unless the physician corrected it,
 * and every written value must carry co-pilot provenance + the derivedFrom link to its source
 * document. Pure (no DB) per PanelService's testable-split pattern.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    Raych
 * @copyright Copyright (c) 2026 Raych
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\Copilot\Tests\Unit;

use OpenEMR\Modules\Copilot\Ingestion\ConfirmedValue;
use OpenEMR\Modules\Copilot\Ingestion\DerivedObservationWriter;
use OpenEMR\Modules\Copilot\Ingestion\DerivedWriteContext;
use OpenEMR\Modules\Copilot\Ingestion\DerivedWriteRejected;
use PHPUnit\Framework\TestCase;

final class DerivedObservationWriterTest extends TestCase
{
    private static function context(): DerivedWriteContext
    {
        return new DerivedWriteContext(
            pid: 5,
            documentId: 25,
            encounterId: 42,
            user: 'physician',
            groupname: 'Default',
            date: '2026-07-14 10:00:00',
            labTypeOptionId: 'lab',
        );
    }

    public function testWritesACitedValueWithProvenanceAndDerivedFromLink(): void
    {
        $value = new ConfirmedValue(
            testName: 'Potassium',
            value: '5.4',
            unit: 'mmol/L',
            loinc: '2823-3',
            referenceRange: '3.5-5.1',
            citationId: 'doc25#k',
            physicianCorrected: false,
        );

        $payload = DerivedObservationWriter::buildPayload($value, self::context());

        self::assertSame('5.4', $payload['ob_value']);
        self::assertSame('mmol/L', $payload['ob_unit']);
        self::assertSame('final', $payload['ob_status']);
        self::assertSame('laboratory', $payload['category']);
        self::assertSame('LOINC:2823-3', $payload['code']);
        self::assertSame(5, $payload['pid']);
        // derivedFrom link to the source document.
        self::assertSame('documents', $payload['ob_documentationof_table']);
        self::assertSame(25, $payload['ob_documentationof_table_id']);
        // The DESCRIPTION is the clean clinical label (no internal metadata) — what the physician sees.
        self::assertSame('Potassium', $payload['description']);
        // Provenance lives in `observation` (the form's Comments column), including citation, source
        // document, and reference range — NOT in the clinical description.
        self::assertIsString($payload['observation']);
        self::assertStringContainsString('co-pilot-derived from document #25', $payload['observation']);
        self::assertStringContainsString('citation doc25#k', $payload['observation']);
        self::assertStringContainsString('ref 3.5-5.1', $payload['observation']);
        self::assertStringNotContainsString('physician-corrected', $payload['observation']);
        self::assertStringNotContainsString('co-pilot-derived', $payload['description']);
    }

    public function testRecordsPhysicianCorrectionAndAllowsAnUncitedCorrectedValue(): void
    {
        // Gate #2 exception: no box-match citation, but the physician edited/confirmed it → writable,
        // recorded physician-corrected (the value no longer matches the page verbatim).
        $value = new ConfirmedValue(
            testName: 'Glucose',
            value: '98',
            unit: 'mg/dL',
            loinc: null,
            referenceRange: null,
            citationId: '',
            physicianCorrected: true,
        );

        $payload = DerivedObservationWriter::buildPayload($value, self::context());

        self::assertSame('Glucose', $payload['description']);
        self::assertIsString($payload['observation']);
        self::assertStringContainsString('physician-corrected', $payload['observation']);
        self::assertStringContainsString('no page box — physician-confirmed', $payload['observation']);
        // No LOINC → coded by text.
        self::assertSame('Glucose', $payload['code']);
    }

    public function testRejectsAnUncitedValueThatWasNotCorrected(): void
    {
        // The core safety gate: an uncited value the physician did NOT edit is a forced-review item,
        // never a silent uncited write.
        $value = new ConfirmedValue(
            testName: 'Sodium',
            value: '140',
            unit: 'mmol/L',
            loinc: null,
            referenceRange: null,
            citationId: '   ',
            physicianCorrected: false,
        );

        $this->expectException(DerivedWriteRejected::class);
        DerivedObservationWriter::buildPayload($value, self::context());
    }

    public function testRejectsAnEmptyValue(): void
    {
        $value = new ConfirmedValue(
            testName: 'Chloride',
            value: '  ',
            unit: null,
            loinc: null,
            referenceRange: null,
            citationId: 'doc25#cl',
            physicianCorrected: false,
        );

        $this->expectException(DerivedWriteRejected::class);
        DerivedObservationWriter::buildPayload($value, self::context());
    }

    public function testDecideWritesWhenNoActiveRowExists(): void
    {
        self::assertSame('write', DerivedObservationWriter::decide([], '4.6'));
    }

    public function testDecideSkipsWhenTheSameValueIsAlreadyActive(): void
    {
        self::assertSame('skip', DerivedObservationWriter::decide([['ob_value' => '4.6']], '4.6'));
        // one match among several still means the value is already on the chart → no-op
        self::assertSame('skip', DerivedObservationWriter::decide([['ob_value' => '4.5'], ['ob_value' => '4.6']], '4.6'));
    }

    public function testDecideSupersedesWhenOnlyDifferentValuesAreActive(): void
    {
        // A different value is on the chart for this (document, code) → the physician revised it.
        self::assertSame('supersede', DerivedObservationWriter::decide([['ob_value' => '4.5']], '4.6'));
        self::assertSame('supersede', DerivedObservationWriter::decide([['ob_value' => '4.4'], ['ob_value' => '4.5']], '4.6'));
    }
}
