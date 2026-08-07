<?php

/**
 * One physician-accepted extracted value, ready to persist to the chart (Week 2 write path, 2f).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    Raych
 * @copyright Copyright (c) 2026 Raych
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\Copilot\Ingestion;

/**
 * A single extracted lab value the physician has ACCEPTED in the review UI. A discarded or
 * untouched value never becomes one of these — the endpoint constructs a ConfirmedValue only for
 * rows the physician explicitly accepted (write-path gate #1: physician confirm). The remaining
 * gates (citation-present-unless-corrected) are enforced by DerivedObservationWriter, not here:
 * this is a plain immutable carrier.
 */
final readonly class ConfirmedValue
{
    public function __construct(
        public string $testName,
        public string $value,
        public ?string $unit,
        /** LOINC code if the extraction/lookup produced one; null → the record is coded by text. */
        public ?string $loinc,
        public ?string $referenceRange,
        /**
         * The box-match citation id from the extraction (`sourceId#fieldOrChunkId`), or '' when the
         * value had no located box on the page. An empty citation is only writable when
         * `physicianCorrected` is true (write-path gate #2).
         */
        public string $citationId,
        /** True when the physician edited the value — it no longer matches the page text verbatim. */
        public bool $physicianCorrected,
    ) {
    }

    /**
     * The value's identity within its document — matches the written Observation's `code` and a
     * {@see DiscardedValue}'s key, so accept/discard decisions for the same value reconcile.
     */
    public function valueKey(): string
    {
        return ValueKey::of($this->loinc, $this->testName);
    }
}
