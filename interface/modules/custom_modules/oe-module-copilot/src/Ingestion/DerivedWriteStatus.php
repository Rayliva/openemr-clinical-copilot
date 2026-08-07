<?php

/**
 * The outcome of persisting one confirmed value (Week 2 write path, 2f).
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
 * What happened to a single accepted value at the write boundary. A rejected value is not
 * represented here — it propagates as {@see DerivedWriteRejected}. A unit enum (no backing value):
 * this is runtime state, never persisted or serialized.
 */
enum DerivedWriteStatus
{
    /** A new Observation was created. */
    case Written;
    /** The same document+value was already persisted — idempotent no-op, no duplicate. */
    case SkippedDuplicate;
    /** The physician revised the value: the prior Observation was voided and a new one written. */
    case Superseded;
}
