<?php

/**
 * Seed a synthetic source document for the Week 2 ingestion demo.
 *
 * Uploads the committed lab-panel fixture PDF to Susan Underwood (pid 2) as a "Lab Report"
 * document, exactly as a front-desk upload would land it: a `documents` row + stored bytes,
 * UUID-registered so it surfaces over the FHIR `DocumentReference` API the co-pilot reads
 * (Week 2 document detection, `w2-ingest-document`). Synthetic/demo data only.
 *
 * Idempotent: skips if Susan already has a document with this name.
 *
 * Run inside the openemr container:
 *   php interface/modules/custom_modules/oe-module-copilot/scripts/seed_test_document.php
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    Raych
 * @copyright Copyright (c) 2026 Raych
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

if (php_sapi_name() !== 'cli') {
    die("This seed script is CLI-only.\n");
}

$_GET['site'] = $argv[1] ?? 'default';
$ignoreAuth = true;
$sessionAllowWrite = true;
require_once __DIR__ . '/../../../../globals.php';

use OpenEMR\Common\Database\QueryUtils;
use OpenEMR\Common\Uuid\UuidRegistry;

const PID = 2;                    // Susan Underwood
const CATEGORY_LAB_REPORT = 2;    // categories.id for "Lab Report"
const DOC_NAME = 'susan-lab-panel.pdf';
const MIME = 'application/pdf';

$_SESSION['authUserId'] = 6;      // Dr. Donna Lee (users.id) — document owner
$_SESSION['authUser'] = 'physician';
$_SESSION['authProvider'] = 'Default';

$pdfPath = realpath(__DIR__ . '/../../../../../copilot/packages/ingestion/fixtures/w2/susan-lab-panel.pdf');
if ($pdfPath === false || !is_readable($pdfPath)) {
    die("Fixture PDF not found or unreadable.\n");
}

// Idempotency: skip if this document already exists for the patient.
$existing = QueryUtils::querySingleRow(
    "SELECT id FROM documents WHERE foreign_id = ? AND name = ? AND deleted = 0",
    [PID, DOC_NAME]
);
$existingId = is_array($existing) && is_numeric($existing['id'] ?? null) ? (int) $existing['id'] : null;
if ($existingId !== null) {
    echo "Document already present for pid " . PID . " (documents.id=" . $existingId . ") — skipping.\n";
    exit(0);
}

$data = file_get_contents($pdfPath);
if ($data === false) {
    die("Could not read the fixture PDF bytes.\n");
}

$document = new Document();
$result = $document->createDocument((string) PID, CATEGORY_LAB_REPORT, DOC_NAME, MIME, $data);
if (is_string($result) && $result !== '') {
    die("createDocument failed: " . $result . "\n");
}

$rawId = $document->get_id();
$documentId = is_numeric($rawId) ? (int) $rawId : 0;

// FHIR DocumentReference ids come from documents.uuid — register any missing document uuids so
// the freshly-created row is visible over the FHIR API the agent reads.
UuidRegistry::createMissingUuidsForTables(['documents']);

$row = QueryUtils::querySingleRow("SELECT LOWER(HEX(uuid)) AS h FROM documents WHERE id = ?", [$documentId]);
$hex = (is_array($row) && is_string($row['h'] ?? null)) ? (string) $row['h'] : '';
$uuid = strlen($hex) === 32
    ? substr($hex, 0, 8) . '-' . substr($hex, 8, 4) . '-' . substr($hex, 12, 4) . '-'
        . substr($hex, 16, 4) . '-' . substr($hex, 20)
    : '(unregistered)';

echo "Uploaded '" . DOC_NAME . "' for pid " . PID . " (documents.id=" . $documentId
    . ", category=Lab Report, fhir uuid=" . $uuid . ").\n";
