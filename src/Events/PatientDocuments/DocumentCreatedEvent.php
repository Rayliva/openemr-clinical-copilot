<?php

/**
 * Fired after a patient document is created, so listeners can react to a new upload (e.g. trigger
 * downstream extraction). Carries an explicit source so a listener can tell an interactive front-desk
 * upload apart from an API/CCDA/portal creation and act only on the ones it wants.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    Raych
 * @copyright Copyright (c) 2026 Raych
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Events\PatientDocuments;

use Symfony\Contracts\EventDispatcher\Event;

final class DocumentCreatedEvent extends Event
{
    /** Dispatched right after a document row + its bytes are created. */
    public const EVENT_HANDLE = 'documents.created';

    /** An interactive upload through the patient Documents UI. */
    public const SOURCE_UPLOAD = 'upload';

    public function __construct(
        private readonly int $documentId,
        private readonly int $patientId,
        private readonly int $categoryId,
        private readonly string $mimeType,
        private readonly string $source,
    ) {
    }

    public function getDocumentId(): int
    {
        return $this->documentId;
    }

    public function getPatientId(): int
    {
        return $this->patientId;
    }

    public function getCategoryId(): int
    {
        return $this->categoryId;
    }

    public function getMimeType(): string
    {
        return $this->mimeType;
    }

    /** One of the `SOURCE_*` constants describing how the document was created. */
    public function getSource(): string
    {
        return $this->source;
    }
}
