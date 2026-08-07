<?php

/**
 * Parsed request body for committing a physician's document-review decisions (Week 2 write path, 2f).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    Raych
 * @copyright Copyright (c) 2026 Raych
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\Copilot\Ingestion;

use InvalidArgumentException;

/**
 * The typed, validated form of the review-commit POST body: which source document, and each value's
 * physician disposition. Parsing is pure and total — it narrows the raw decoded JSON (`mixed`, from an
 * untrusted client) at the boundary into typed ACCEPTED `ConfirmedValue`s (write-path gate #1 — only
 * these reach the writer), DISCARDED `DiscardedValue`s (recorded as dismissed, never written), and a
 * flag for whether any value was left UNDECIDED (so the document is not yet fully reviewed). Malformed
 * input throws rather than silently coercing.
 */
final readonly class ReviewCommitRequest
{
    /**
     * @param list<ConfirmedValue> $acceptedValues
     * @param list<DiscardedValue> $discardedValues
     */
    public function __construct(
        public string $documentFhirId,
        public array $acceptedValues,
        public array $discardedValues = [],
        /** True when ≥1 value was left undecided → the document is NOT fully reviewed this commit. */
        public bool $hasUndecided = false,
        /** The document's collection date (from the extraction), used to date the written Observations. */
        public ?string $collectionDate = null,
    ) {
    }

    /**
     * Parse the decoded JSON body `{documentId:string (FHIR DocumentReference id), values:[{testName,
     * value, unit?, loinc?, referenceRange?, citationId, accepted:bool, physicianCorrected:bool},
     * ...]}`. Only rows with `accepted === true` become `ConfirmedValue`s. Throws
     * {@see InvalidArgumentException} on a malformed shape (the endpoint maps that to a 400 — never a
     * partial/garbage write). The endpoint resolves the FHIR id to the local `documents` row + pid.
     */
    public static function fromDecodedJson(mixed $body): self
    {
        if (!is_array($body)) {
            throw new InvalidArgumentException('body must be a JSON object');
        }
        $documentFhirId = $body['documentId'] ?? null;
        if (!is_string($documentFhirId) || $documentFhirId === '') {
            throw new InvalidArgumentException('documentId (FHIR id) is required');
        }

        $values = $body['values'] ?? null;
        if (!is_array($values)) {
            throw new InvalidArgumentException('values must be an array');
        }

        $accepted = [];
        $discarded = [];
        $hasUndecided = false;
        foreach ($values as $row) {
            if (!is_array($row)) {
                throw new InvalidArgumentException('each value must be an object');
            }
            switch (self::dispositionOf($row)) {
                case 'accepted':
                    $accepted[] = new ConfirmedValue(
                        testName: self::requireString($row, 'testName'),
                        value: self::requireString($row, 'value'),
                        unit: self::optionalString($row, 'unit'),
                        loinc: self::optionalString($row, 'loinc'),
                        referenceRange: self::optionalString($row, 'referenceRange'),
                        citationId: self::optionalString($row, 'citationId') ?? '',
                        physicianCorrected: ($row['physicianCorrected'] ?? false) === true,
                    );
                    break;
                case 'discarded':
                    $discarded[] = new DiscardedValue(
                        testName: self::requireString($row, 'testName'),
                        value: self::requireString($row, 'value'),
                        loinc: self::optionalString($row, 'loinc'),
                    );
                    break;
                default:
                    $hasUndecided = true;
            }
        }

        return new self(
            $documentFhirId,
            $accepted,
            $discarded,
            $hasUndecided,
            self::optionalString($body, 'collectionDate'),
        );
    }

    /**
     * A row's disposition: the explicit `disposition` field when present
     * (`accepted`|`discarded`|`undecided`), else the legacy `accepted` boolean (true → accepted, else
     * → undecided — a value is NEVER silently discarded). An unknown disposition string is rejected.
     *
     * @param array<array-key, mixed> $row
     */
    private static function dispositionOf(array $row): string
    {
        $d = $row['disposition'] ?? null;
        if (is_string($d)) {
            if ($d === 'accepted' || $d === 'discarded' || $d === 'undecided') {
                return $d;
            }
            throw new InvalidArgumentException("invalid disposition '$d'");
        }
        return ($row['accepted'] ?? false) === true ? 'accepted' : 'undecided';
    }

    /**
     * @param array<array-key, mixed> $row
     */
    private static function requireString(array $row, string $key): string
    {
        $v = $row[$key] ?? null;
        if (!is_string($v) || $v === '') {
            throw new InvalidArgumentException("missing required string '$key'");
        }
        return $v;
    }

    /**
     * @param array<array-key, mixed> $row
     */
    private static function optionalString(array $row, string $key): ?string
    {
        $v = $row[$key] ?? null;
        return is_string($v) && $v !== '' ? $v : null;
    }
}
