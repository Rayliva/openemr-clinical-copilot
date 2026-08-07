<?php

/**
 * The canonical identity of an extracted value within its document (Week 2 review workflow).
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
 * One place that computes a value's key so accepted decisions, discarded decisions, and the written
 * Observation's `code` all agree — `LOINC:<loinc>` when a LOINC is present, else the test name. If
 * these ever diverged, a discard and a later accept of the same value would not reconcile.
 */
final class ValueKey
{
    public static function of(?string $loinc, string $testName): string
    {
        return $loinc !== null && trim($loinc) !== '' ? 'LOINC:' . $loinc : $testName;
    }
}
