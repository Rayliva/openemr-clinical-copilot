<?php

/**
 * The session-scoped context for persisting a confirmed value (Week 2 write path, 2f).
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
 * Everything a write needs that comes from the authenticated session + the source document, never
 * from the request body: the OWNED pid (already passed the PanelService ownership gate), the source
 * `documents.id` (for the `derivedFrom` link), the encounter, the acting user/group, the timestamp,
 * and the `Observation_Types` option_id that makes the row read back under FHIR category
 * `laboratory`. Assembling this in the endpoint (not the model) keeps pid/identity un-spoofable.
 */
final readonly class DerivedWriteContext
{
    public function __construct(
        public int $pid,
        /** The source uploaded document's `documents.id` — the derivedFrom anchor + idempotency key. */
        public int $documentId,
        public int $encounterId,
        public string $user,
        public string $groupname,
        /** `Y-m-d H:i:s` — the document's COLLECTION date when known, else the commit time. */
        public string $date,
        /** `list_options` option_id in `Observation_Types` that surfaces the row as FHIR `laboratory`. */
        public string $labTypeOptionId,
        /**
         * The `form_observation.form_id` this value joins, so all of a document's values group into one
         * encounter form entry. 0 → let the write create a new form (the document's first value).
         */
        public int $formId = 0,
    ) {
    }
}
