<?php

/**
 * Seed a MULTI-VISIT extracted-lab trend for the Week 2 lab-trend widget.
 *
 * The realistic scenario the trend chart is built for: a patient has one lab PDF today, another a few
 * months later. This seeds THREE dated lab-report PDFs for Grace Bello (an anemia panel improving on
 * iron treatment) as separate `documents`, and commits each visit's values as `form_observation`
 * rows dated at that visit's collection date, `derivedFrom` its own document — through the real
 * {@see DerivedObservationWriter} (all gates + idempotency). The union of these Observations
 * (`category=laboratory`) is what `POST /labs/series` groups into a per-test time line, and each
 * point traces back to its own PDF (click-to-source). Synthetic/demo data only.
 *
 * Idempotent: creates Grace only if absent, uploads each PDF only if absent, and the writer no-ops a
 * re-commit of the same value. Safe to re-run.
 *
 * Run inside the openemr container (PDFs come from copilot/demo-documents, deployed via git):
 *   php interface/modules/custom_modules/oe-module-copilot/scripts/seed_lab_trend.php
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
use OpenEMR\Modules\Copilot\Ingestion\ConfirmedValue;
use OpenEMR\Modules\Copilot\Ingestion\DerivedObservationWriter;
use OpenEMR\Modules\Copilot\Ingestion\DerivedWriteContext;
use OpenEMR\Modules\Copilot\Ingestion\DerivedWriteRejected;
use OpenEMR\Services\EncounterService;
use OpenEMR\Services\ObservationService;
use OpenEMR\Services\PatientService;

const PROVIDER_ID = 6;              // Dr. Donna Lee
const PROVIDER_USER = 'physician';
const GROUP_NAME = 'Default';
const CATEGORY_LAB_REPORT = 2;      // categories.id for "Lab Report"
const MIME = 'application/pdf';

$_SESSION['authUserId'] = PROVIDER_ID;
$_SESSION['authUser'] = PROVIDER_USER;
$_SESSION['authProvider'] = GROUP_NAME;

// The three visits: same tests (Hemoglobin/MCV/Ferritin, by LOINC) trending up as the anemia
// resolves. Each visit is one PDF (in copilot/demo-documents) + one collection-dated form.
$visits = [
    ['date' => '2026-01-10', 'doc' => 'bello-grace-lab-2026-01-10.pdf', 'values' => [
        ['Hemoglobin', '11.4', 'g/dL', '718-7'],
        ['MCV', '78', 'fL', '787-2'],
        ['Ferritin', '11', 'ng/mL', '2276-4'],
    ]],
    ['date' => '2026-04-15', 'doc' => 'bello-grace-lab-2026-04-15.pdf', 'values' => [
        ['Hemoglobin', '12.3', 'g/dL', '718-7'],
        ['MCV', '82', 'fL', '787-2'],
        ['Ferritin', '28', 'ng/mL', '2276-4'],
    ]],
    ['date' => '2026-07-04', 'doc' => 'bello-grace-lab-2026-07-04.pdf', 'values' => [
        ['Hemoglobin', '13.1', 'g/dL', '718-7'],
        ['MCV', '86', 'fL', '787-2'],
        ['Ferritin', '45', 'ng/mL', '2276-4'],
    ]],
];

$docDir = realpath(__DIR__ . '/../../../../../copilot/demo-documents');
if ($docDir === false) {
    die("demo-documents dir not found.\n");
}

// ---- Ensure the patient exists (Grace Bello, on Dr. Lee's panel) ----
$patientSvc = new PatientService();
$found = QueryUtils::querySingleRow(
    "SELECT pid, uuid FROM patient_data WHERE fname = 'Grace' AND lname = 'Bello' LIMIT 1"
);
if (is_array($found) && is_numeric($found['pid'] ?? null)) {
    $pid = (int) $found['pid'];
    $puuid = UuidRegistry::uuidToString($found['uuid']);
    echo "Grace Bello — exists pid={$pid}\n";
} else {
    $res = $patientSvc->insert([
        'fname' => 'Grace', 'lname' => 'Bello', 'sex' => 'Female',
        'DOB' => '1990-06-18', 'providerID' => PROVIDER_ID,
    ]);
    if (method_exists($res, 'isValid') && !$res->isValid()) {
        die("Could not create Grace Bello: " . json_encode($res->getValidationMessages()) . "\n");
    }
    $row = $res->getData()[0];
    $pid = (int) $row['pid'];
    $puuid = (string) $row['uuid'];
    echo "Grace Bello — created pid={$pid}\n";
}

// ---- Ensure an encounter exists to attach the derived forms to ----
$enc = QueryUtils::querySingleRow(
    "SELECT encounter FROM form_encounter WHERE pid = ? ORDER BY date DESC, encounter DESC LIMIT 1",
    [$pid]
);
$encounterId = is_array($enc) && is_numeric($enc['encounter'] ?? null) ? (int) $enc['encounter'] : 0;
if ($encounterId <= 0) {
    $created = (new EncounterService())->insertEncounter($puuid, [
        'date' => '2026-07-04 09:00:00', 'provider_id' => PROVIDER_ID, 'user' => PROVIDER_USER,
        'group' => GROUP_NAME, 'reason' => 'Lab review', 'pc_catid' => 5, 'facility_id' => 3, 'class_code' => 'AMB',
    ]);
    $encounterId = (int) $created->getData()[0]['encounter'];
    echo "  created encounter {$encounterId}\n";
}

/** Upload a lab PDF as a Lab Report document (idempotent); return its documents.id. */
function ensureDocument(int $pid, string $docDir, string $name): int
{
    $existing = QueryUtils::querySingleRow(
        "SELECT id FROM documents WHERE foreign_id = ? AND name = ? AND deleted = 0",
        [$pid, $name]
    );
    if (is_array($existing) && is_numeric($existing['id'] ?? null)) {
        return (int) $existing['id'];
    }
    $bytes = @file_get_contents($docDir . '/' . $name);
    if ($bytes === false) {
        die("PDF not readable: {$name}\n");
    }
    $document = new Document();
    $err = $document->createDocument((string) $pid, CATEGORY_LAB_REPORT, $name, MIME, $bytes);
    if (is_string($err) && $err !== '') {
        die("createDocument failed for {$name}: {$err}\n");
    }
    UuidRegistry::createMissingUuidsForTables(['documents']);
    return (int) $document->get_id();
}

// Clean slate: drop Grace's EXISTING document-derived lab observations (prior review-flow commits can
// carry commit-time dates that would split/pollute the trend) + their now-empty encounter forms, so
// the trend is exactly the three seeded visits. Scoped to her documents; native labs are untouched.
$priorForms = QueryUtils::fetchRecords(
    "SELECT DISTINCT fo.form_id FROM form_observation fo"
    . " JOIN documents d ON d.id = fo.ob_documentationof_table_id"
    . " WHERE fo.ob_documentationof_table = 'documents' AND d.foreign_id = ?",
    [$pid]
);
QueryUtils::sqlStatementThrowException(
    "DELETE fo FROM form_observation fo"
    . " JOIN documents d ON d.id = fo.ob_documentationof_table_id"
    . " WHERE fo.ob_documentationof_table = 'documents' AND d.foreign_id = ?",
    [$pid]
);
foreach ($priorForms as $pf) {
    $fid = is_numeric($pf['form_id'] ?? null) ? (int) $pf['form_id'] : 0;
    if ($fid > 0 && QueryUtils::fetchRecords('SELECT id FROM form_observation WHERE form_id = ? LIMIT 1', [$fid]) === []) {
        QueryUtils::sqlStatementThrowException("DELETE FROM forms WHERE form_id = ? AND formdir = 'observation'", [$fid]);
    }
}
echo "  cleared " . count($priorForms) . " prior derived-lab form(s)\n";

$writer = new DerivedObservationWriter(new ObservationService());

foreach ($visits as $visit) {
    $documentId = ensureDocument($pid, $docDir, $visit['doc']);
    echo "  {$visit['doc']} → documents.id={$documentId}\n";
    $collectionDate = $visit['date'] . ' 00:00:00';

    // Group this visit's values into ONE collection-dated form (first write creates it; rest join).
    $formId = 0;
    foreach ($visit['values'] as [$testName, $value, $unit, $loinc]) {
        $cv = new ConfirmedValue($testName, $value, $unit, $loinc, null, $visit['doc'] . '#' . strtolower($testName), false);
        $ctx = new DerivedWriteContext(
            pid: $pid,
            documentId: $documentId,
            encounterId: $encounterId,
            user: PROVIDER_USER,
            groupname: GROUP_NAME,
            date: $collectionDate,
            labTypeOptionId: 'laboratory',
            formId: $formId,
        );
        try {
            $status = $writer->commit($cv, $ctx);
            echo "     {$testName} {$value} {$unit} ({$visit['date']}): {$status->name}\n";
        } catch (DerivedWriteRejected $e) {
            echo "     {$testName}: REJECTED — " . $e->getMessage() . "\n";
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
}

echo "\nDone. Grace Bello now has a 3-visit lab trend (Hemoglobin / MCV / Ferritin), each point derived from its own PDF.\n";
