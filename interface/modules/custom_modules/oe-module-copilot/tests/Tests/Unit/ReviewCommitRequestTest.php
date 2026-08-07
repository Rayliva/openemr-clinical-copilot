<?php

/**
 * Review-commit request-parsing unit tests (Week 2 write path, 2f). Regression guard: only
 * physician-ACCEPTED rows become writable values (gate #1), and malformed input is rejected rather
 * than coerced into a partial write. Pure (no DB).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    Raych
 * @copyright Copyright (c) 2026 Raych
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\Copilot\Tests\Unit;

use InvalidArgumentException;
use OpenEMR\Modules\Copilot\Ingestion\ReviewCommitRequest;
use PHPUnit\Framework\TestCase;

final class ReviewCommitRequestTest extends TestCase
{
    public function testKeepsOnlyAcceptedRowsAndParsesTheirFields(): void
    {
        $req = ReviewCommitRequest::fromDecodedJson([
            'documentId' => 'a2422f12-ae58-4960-9814-fc9e9e8550d7',
            'values' => [
                ['testName' => 'Potassium', 'value' => '5.4', 'unit' => 'mmol/L', 'citationId' => 'd25#k', 'accepted' => true, 'physicianCorrected' => false],
                ['testName' => 'Sodium', 'value' => '140', 'citationId' => 'd25#na', 'accepted' => false, 'physicianCorrected' => false],
                ['testName' => 'Glucose', 'value' => '99', 'citationId' => '', 'accepted' => true, 'physicianCorrected' => true],
            ],
        ]);

        self::assertSame('a2422f12-ae58-4960-9814-fc9e9e8550d7', $req->documentFhirId);
        self::assertCount(2, $req->acceptedValues); // Sodium was not accepted → dropped
        self::assertSame('Potassium', $req->acceptedValues[0]->testName);
        self::assertSame('mmol/L', $req->acceptedValues[0]->unit);
        self::assertFalse($req->acceptedValues[0]->physicianCorrected);
        self::assertSame('Glucose', $req->acceptedValues[1]->testName);
        self::assertTrue($req->acceptedValues[1]->physicianCorrected);
        self::assertNull($req->acceptedValues[1]->unit);
    }

    public function testAcceptsAFhirIdStringAndEmptyValues(): void
    {
        $req = ReviewCommitRequest::fromDecodedJson(['documentId' => 'doc-uuid', 'values' => []]);
        self::assertSame('doc-uuid', $req->documentFhirId);
        self::assertSame([], $req->acceptedValues);
    }

    public function testRejectsANonObjectBody(): void
    {
        $this->expectException(InvalidArgumentException::class);
        ReviewCommitRequest::fromDecodedJson('nope');
    }

    public function testRejectsAMissingDocumentId(): void
    {
        $this->expectException(InvalidArgumentException::class);
        ReviewCommitRequest::fromDecodedJson(['values' => []]);
    }

    public function testRejectsAnAcceptedRowMissingRequiredFields(): void
    {
        $this->expectException(InvalidArgumentException::class);
        ReviewCommitRequest::fromDecodedJson([
            'documentId' => 25,
            'values' => [['accepted' => true, 'unit' => 'mmol/L']], // no testName/value
        ]);
    }

    public function testParsesDispositionsIntoAcceptedDiscardedAndUndecided(): void
    {
        $req = ReviewCommitRequest::fromDecodedJson([
            'documentId' => 'doc-uuid',
            'values' => [
                ['testName' => 'Potassium', 'value' => '4.6', 'unit' => 'mEq/L', 'loinc' => '2823-3', 'citationId' => 'd#k', 'disposition' => 'accepted', 'physicianCorrected' => false],
                ['testName' => 'Sodium', 'value' => '140', 'citationId' => '', 'disposition' => 'discarded'],
                ['testName' => 'Glucose', 'value' => '99', 'citationId' => 'd#g', 'disposition' => 'undecided'],
            ],
        ]);

        self::assertCount(1, $req->acceptedValues);
        self::assertSame('Potassium', $req->acceptedValues[0]->testName);
        self::assertCount(1, $req->discardedValues);
        self::assertSame('Sodium', $req->discardedValues[0]->testName);
        self::assertSame('140', $req->discardedValues[0]->value);
        self::assertSame('Sodium', $req->discardedValues[0]->valueKey()); // no loinc → testName
        self::assertTrue($req->hasUndecided); // Glucose is undecided → the document is not fully reviewed
    }

    public function testDiscardedValueKeyUsesLoincWhenPresent(): void
    {
        $req = ReviewCommitRequest::fromDecodedJson([
            'documentId' => 'd',
            'values' => [['testName' => 'Hemoglobin A1c', 'value' => '8.1', 'loinc' => '4548-4', 'citationId' => 'd#a', 'disposition' => 'discarded']],
        ]);
        self::assertSame('LOINC:4548-4', $req->discardedValues[0]->valueKey());
    }

    public function testEveryValueDecidedMeansNoUndecided(): void
    {
        $req = ReviewCommitRequest::fromDecodedJson([
            'documentId' => 'd',
            'values' => [
                ['testName' => 'Potassium', 'value' => '4.6', 'citationId' => 'd#k', 'disposition' => 'accepted', 'physicianCorrected' => false],
                ['testName' => 'Sodium', 'value' => '140', 'citationId' => '', 'disposition' => 'discarded'],
            ],
        ]);
        self::assertFalse($req->hasUndecided); // all decided → the document becomes reviewed
    }

    public function testBackwardCompatibleWithAcceptedBoolean(): void
    {
        // The pre-disposition wire shape (accepted:bool, no disposition) still parses: accepted→accepted,
        // not-accepted→undecided (never silently discarded).
        $req = ReviewCommitRequest::fromDecodedJson([
            'documentId' => 'd',
            'values' => [
                ['testName' => 'Potassium', 'value' => '4.6', 'citationId' => 'd#k', 'accepted' => true, 'physicianCorrected' => false],
                ['testName' => 'Sodium', 'value' => '140', 'citationId' => '', 'accepted' => false, 'physicianCorrected' => false],
            ],
        ]);
        self::assertCount(1, $req->acceptedValues);
        self::assertCount(0, $req->discardedValues);
        self::assertTrue($req->hasUndecided);
    }

    public function testRejectsADiscardedRowMissingItsValue(): void
    {
        $this->expectException(InvalidArgumentException::class);
        ReviewCommitRequest::fromDecodedJson([
            'documentId' => 'd',
            'values' => [['testName' => 'Sodium', 'disposition' => 'discarded']], // no value
        ]);
    }

    public function testParsesTheCollectionDateWhenPresentAndNullOtherwise(): void
    {
        $withDate = ReviewCommitRequest::fromDecodedJson([
            'documentId' => 'd',
            'collectionDate' => '2026-07-10',
            'values' => [['testName' => 'Potassium', 'value' => '4.6', 'citationId' => 'd#k', 'disposition' => 'accepted', 'physicianCorrected' => false]],
        ]);
        self::assertSame('2026-07-10', $withDate->collectionDate);

        $noDate = ReviewCommitRequest::fromDecodedJson(['documentId' => 'd', 'values' => []]);
        self::assertNull($noDate->collectionDate);
    }
}
