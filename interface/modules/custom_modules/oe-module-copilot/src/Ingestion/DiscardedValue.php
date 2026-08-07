<?php

/**
 * One extracted value the physician explicitly DISCARDED in the review UI (Week 2 review workflow).
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
 * A value the physician dismissed (chose NOT to write). Unlike an accepted value it never becomes an
 * Observation — it is recorded only as a "dismissed" review decision so a reload remembers the choice
 * and the value is not re-surfaced as undecided. Its {@see valueKey()} is the SAME identity the write
 * path codes an Observation by (`LOINC:<loinc>` when present, else the test name), so accepted and
 * discarded decisions for the same value share one key.
 */
final readonly class DiscardedValue
{
    public function __construct(
        public string $testName,
        /** The dismissed value, kept for display ("Sodium 140 — dismissed") on reopen. */
        public string $value,
        /** LOINC code if the extraction produced one; null → keyed by test name. */
        public ?string $loinc,
    ) {
    }

    /**
     * The value's identity within its document — matches DerivedObservationWriter's `code`, so a
     * discard and a later accept of the same value reconcile to one decision.
     */
    public function valueKey(): string
    {
        return ValueKey::of($this->loinc, $this->testName);
    }
}
