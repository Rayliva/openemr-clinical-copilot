<?php

/**
 * Seed committed *derived* lab observations for the Week 2 source-viewer demo.
 *
 * The source-viewer (chat "View source document") only lights up for a lab value that was extracted
 * from an ingested PDF and **committed** — i.e. a `form_observation` row linked (`ob_documentationof_*`)
 * to its source `documents` row. That commit is normally physician-gated (the review UI). This CLI
 * seed performs the SAME write through the real {@see DerivedObservationWriter} (all its gates +
 * idempotency hold) so a demo environment has a document-derived citation without a manual click.
 * Synthetic/demo data only; values mirror the committed `susan-lab-panel.pdf` fixture so the box
 * re-locates on the page. Clean re-seed: drops + regroups the document's derived observations into ONE
 * collection-dated form (so the demo shows the grouping + collection-date behavior).
 *
 * Run inside the openemr container (after seed_test_document.php):
 *   php interface/modules/custom_modules/oe-module-copilot/scripts/seed_derived_lab.php
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
use OpenEMR\Modules\Copilot\Ingestion\ConfirmedValue;
use OpenEMR\Modules\Copilot\Ingestion\DerivedObservationWriter;
use OpenEMR\Modules\Copilot\Ingestion\DerivedWriteContext;
use OpenEMR\Modules\Copilot\Ingestion\DerivedWriteRejected;
use OpenEMR\Services\ObservationService;

const PID = 2; // Susan Underwood
$_SESSION['authUserId'] = 6;
$_SESSION['authUser'] = 'physician';
$_SESSION['authProvider'] = 'Default';

$doc = QueryUtils::querySingleRow(
    "SELECT id FROM documents WHERE foreign_id = ? AND name = 'susan-lab-panel.pdf' AND deleted = 0",
    [PID]
);
if (!is_array($doc) || !is_numeric($doc['id'] ?? null)) {
    die("No uploaded lab document for pid " . PID . " — run seed_test_document.php first.\n");
}
$documentId = (int) $doc['id'];

$enc = QueryUtils::querySingleRow(
    "SELECT encounter FROM form_encounter WHERE pid = ? ORDER BY date DESC, encounter DESC LIMIT 1",
    [PID]
);
$encounterId = is_array($enc) && is_numeric($enc['encounter'] ?? null) ? (int) $enc['encounter'] : 0;
if ($encounterId <= 0) {
    die("No encounter for pid " . PID . " — cannot attach the derived observation.\n");
}

// The panel's collection date (from the susan-lab-panel extraction). The Observations are dated by
// this, NOT the seed run time, so the demo shows the collection-date behavior.
$collectionDate = '2026-07-10 00:00:00';

$writer = new DerivedObservationWriter(new ObservationService());
// Values from the verified susan-lab-panel.pdf extraction (value strings match so box-match re-locates).
$values = [
    new ConfirmedValue('Hemoglobin A1c', '8.1', '%', null, null, 'susan-lab-panel#a1c', false),
    new ConfirmedValue('eGFR', '45', 'mL/min/1.73m2', null, null, 'susan-lab-panel#egfr', false),
];

// Clean re-seed: drop any prior derived observations for this document (older seeds wrote each value as
// its own now-dated form) + their now-empty encounter form entries, so the values re-land as ONE
// grouped, collection-dated form.
$priorForms = QueryUtils::fetchRecords(
    "SELECT DISTINCT form_id FROM form_observation WHERE ob_documentationof_table = 'documents' AND ob_documentationof_table_id = ?",
    [$documentId]
);
QueryUtils::sqlStatementThrowException(
    "DELETE FROM form_observation WHERE ob_documentationof_table = 'documents' AND ob_documentationof_table_id = ?",
    [$documentId]
);
foreach ($priorForms as $pf) {
    $fid = is_numeric($pf['form_id'] ?? null) ? (int) $pf['form_id'] : 0;
    if ($fid > 0 && QueryUtils::fetchRecords('SELECT id FROM form_observation WHERE form_id = ? LIMIT 1', [$fid]) === []) {
        QueryUtils::sqlStatementThrowException("DELETE FROM forms WHERE form_id = ? AND formdir = 'observation'", [$fid]);
    }
}

// Group all values into one form: the first write creates it; the rest join it via its form_id.
$formId = 0;
foreach ($values as $v) {
    $ctx = new DerivedWriteContext(
        pid: PID,
        documentId: $documentId,
        encounterId: $encounterId,
        user: 'physician',
        groupname: 'Default',
        date: $collectionDate,
        labTypeOptionId: 'laboratory',
        formId: $formId,
    );
    try {
        $status = $writer->commit($v, $ctx);
        echo $v->testName . " (" . $v->value . "): " . $status->name . "\n";
    } catch (DerivedWriteRejected $e) {
        echo $v->testName . " (" . $v->value . "): REJECTED — " . $e->getMessage() . "\n";
    }
    if ($formId === 0) {
        $firstRow = QueryUtils::querySingleRow(
            "SELECT form_id FROM form_observation WHERE ob_documentationof_table = 'documents' AND ob_documentationof_table_id = ? ORDER BY id ASC LIMIT 1",
            [$documentId]
        );
        if (is_array($firstRow) && is_numeric($firstRow['form_id'] ?? null)) {
            $formId = (int) $firstRow['form_id'];
        }
    }
}

$rows = QueryUtils::sqlStatementThrowException(
    "SELECT LOWER(HEX(uuid)) AS h, ob_value FROM form_observation"
    . " WHERE ob_documentationof_table = 'documents' AND ob_documentationof_table_id = ?",
    [$documentId]
);
while ($r = sqlFetchArray($rows)) {
    echo "derived observation uuid=" . $r['h'] . " value=" . $r['ob_value'] . "\n";
}
