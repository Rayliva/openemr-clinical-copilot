<?php

/**
 * Raised when a confirmed value fails a write-path gate (Week 2 write path, 2f).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    Raych
 * @copyright Copyright (c) 2026 Raych
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\Copilot\Ingestion;

use DomainException;

/**
 * Thrown when a value cannot be persisted because it violates a write-path safety gate — an empty
 * value, or (the important one) a value with no box-match citation that the physician did not edit.
 * The endpoint reports this per-value as `rejected` rather than writing a silent, uncited fact.
 */
final class DerivedWriteRejected extends DomainException
{
}
