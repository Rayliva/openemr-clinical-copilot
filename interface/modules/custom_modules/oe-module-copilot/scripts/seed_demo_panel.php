<?php

/**
 * Seed a synthetic demo panel for the Clinical Co-Pilot UC-1 (morning huddle).
 *
 * Creates ~6 clinically-varied patients OWNED by provider 6 (Dr. Donna Lee), each
 * with problems / meds / allergies chosen to exercise the agent's safety surface
 * (duplicate therapy, allergy contraindication, undocumented-allergy guard), plus a
 * today appointment on provider 6's calendar. Also puts the existing seed patient
 * Susan (pid 2, med-status conflict) on today's schedule.
 *
 * Uses OpenEMR services (never raw SQL) so every row is UUID-registered and therefore
 * visible via the FHIR API the agent reads. Synthetic/demo data only.
 *
 * Idempotent: skips patients that already exist and appointments already on today's
 * calendar, so it is safe to re-run (e.g. to refresh "today's" appointments).
 *
 * Run inside the openemr container:
 *   php interface/modules/custom_modules/oe-module-copilot/scripts/seed_demo_panel.php
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
use OpenEMR\Services\AllergyIntoleranceService;
use OpenEMR\Services\AppointmentService;
use OpenEMR\Services\ConditionService;
use OpenEMR\Services\PatientService;
use OpenEMR\Services\PrescriptionService;

const PROVIDER_ID = 6;   // Dr. Donna Lee (users.id)
const FACILITY_ID = 3;   // Great Clinic (verify with: SELECT id FROM facility)

/**
 * Panel definition. Drug names are the BARE generic (dosage kept separate) so the
 * constraint engine's drug→class map matches (duplicate-therapy / contraindication).
 *
 * @var list<array<string, mixed>>
 */
$panel = [
    [
        'fname' => 'Marcus', 'lname' => 'Fielding', 'sex' => 'Male', 'dob' => '1958-03-22',
        'time' => '09:00',
        'problems' => [
            ['title' => 'Type 2 diabetes mellitus', 'code' => 'ICD10:E11.9', 'begdate' => '2021-05-10'],
            ['title' => 'Essential hypertension', 'code' => 'ICD10:I10', 'begdate' => '2019-02-01'],
        ],
        'allergies' => [],
        'meds' => [
            ['drug' => 'Metformin', 'dosage' => '500 mg BID'],
            ['drug' => 'Lisinopril', 'dosage' => '10 mg daily'],
        ],
    ],
    [
        'fname' => 'Rosa', 'lname' => 'Alvarez', 'sex' => 'Female', 'dob' => '1971-11-05',
        'time' => '09:15',
        'problems' => [
            ['title' => 'Acute sinusitis', 'code' => 'ICD10:J01.90', 'begdate' => '2026-07-01'],
        ],
        // Penicillin allergy + amoxicillin (penicillin class) => contraindication warning.
        // The code is required: without a coded diagnosis OpenEMR's FHIR emits the
        // allergen as "Unknown" (the title only reaches the narrative), so the mapper
        // sees "Unknown" and the class-based contraindication check cannot fire.
        'allergies' => [['title' => 'Penicillin', 'code' => 'RXNORM:7980', 'begdate' => '2010-01-01']],
        'meds' => [['drug' => 'Amoxicillin', 'dosage' => '500 mg TID']],
    ],
    [
        'fname' => 'Harold', 'lname' => 'Kim', 'sex' => 'Male', 'dob' => '1949-07-14',
        'time' => '09:30',
        'problems' => [
            ['title' => 'Hyperlipidemia', 'code' => 'ICD10:E78.5', 'begdate' => '2018-09-12'],
        ],
        'allergies' => [],
        // Two statins => duplicate-therapy warning.
        'meds' => [
            ['drug' => 'Atorvastatin', 'dosage' => '40 mg daily'],
            ['drug' => 'Simvastatin', 'dosage' => '20 mg daily'],
        ],
    ],
    [
        'fname' => 'Denise', 'lname' => 'Carter', 'sex' => 'Female', 'dob' => '1985-02-28',
        'time' => '09:45',
        'problems' => [
            ['title' => 'Asthma', 'code' => 'ICD10:J45.909', 'begdate' => '2015-03-20'],
        ],
        'allergies' => [],
        'meds' => [['drug' => 'Albuterol', 'dosage' => '90 mcg PRN']],
    ],
    [
        'fname' => 'Frank', 'lname' => 'Nguyen', 'sex' => 'Male', 'dob' => '1962-09-09',
        'time' => '10:00',
        'problems' => [
            ['title' => 'Congestive heart failure', 'code' => 'ICD10:I50.9', 'begdate' => '2022-11-03'],
            ['title' => 'Atrial fibrillation', 'code' => 'ICD10:I48.91', 'begdate' => '2023-04-18'],
        ],
        'allergies' => [['title' => 'Sulfa drugs', 'code' => 'RXNORM:10180', 'begdate' => '2005-01-01']],
        'meds' => [
            ['drug' => 'Furosemide', 'dosage' => '40 mg daily'],
            ['drug' => 'Warfarin', 'dosage' => '5 mg daily'],
            ['drug' => 'Metoprolol', 'dosage' => '50 mg BID'],
        ],
    ],
    [
        'fname' => 'Grace', 'lname' => 'Bello', 'sex' => 'Female', 'dob' => '1990-06-18',
        'time' => '10:15',
        'problems' => [
            ['title' => 'Migraine', 'code' => 'ICD10:G43.909', 'begdate' => '2017-08-08'],
        ],
        'allergies' => [],
        'meds' => [['drug' => 'Sumatriptan', 'dosage' => '50 mg PRN']],
    ],
];

$patientSvc = new PatientService();
$condSvc = new ConditionService();
$allergySvc = new AllergyIntoleranceService();
$rxSvc = new PrescriptionService();
$apptSvc = new AppointmentService();

/** Find an existing pid by identity, so re-runs don't duplicate patients. */
function findPid(string $fname, string $lname, string $dob): ?int
{
    $rows = QueryUtils::fetchRecords(
        'SELECT pid FROM patient_data WHERE fname = ? AND lname = ? AND DOB = ? LIMIT 1',
        [$fname, $lname, $dob]
    );
    $pid = $rows[0]['pid'] ?? null;
    return is_numeric($pid) ? (int) $pid : null;
}

function apptExistsToday(int $pid): bool
{
    $rows = QueryUtils::fetchRecords(
        'SELECT pc_eid FROM openemr_postcalendar_events WHERE pc_pid = ? AND pc_eventDate = CURDATE() LIMIT 1',
        [$pid]
    );
    return count($rows) > 0;
}

function ensureApptToday(AppointmentService $svc, int $pid, string $startTime, string $reason): void
{
    if (apptExistsToday($pid)) {
        echo "    appt today: already present\n";
        return;
    }
    $svc->insert($pid, [
        'pc_catid' => 5,               // Office Visit
        'pc_title' => 'Office Visit',
        'pc_duration' => 900,          // seconds (15 min)
        'pc_hometext' => $reason,
        'pc_apptstatus' => '-',
        'pc_eventDate' => date('Y-m-d'),
        'pc_startTime' => $startTime,
        'pc_facility' => FACILITY_ID,
        'pc_billing_location' => FACILITY_ID,
        'pc_aid' => PROVIDER_ID,
    ]);
    echo "    appt today: created at {$startTime}\n";
}

/** CVX vaccine code → display, for the small demo set. */
const CVX_NAMES = [
    '140' => 'Influenza, seasonal, injectable, preservative free',
    '115' => 'Tdap',
    '33' => 'Pneumococcal polysaccharide PPSV23',
];

function cvxCodeTypeId(): ?int
{
    $rows = QueryUtils::fetchRecords("SELECT ct_id FROM code_types WHERE ct_key = 'CVX' LIMIT 1", []);
    $id = $rows[0]['ct_id'] ?? null;
    return is_numeric($id) ? (int) $id : null;
}

/** Ensure a `codes` row for each demo CVX code so FHIR emits a vaccine display name. */
function seedCvxCodes(): void
{
    $ctId = cvxCodeTypeId();
    if ($ctId === null) {
        echo "  (no CVX code_type found; vaccine display will fall back to the raw code)\n";
        return;
    }
    foreach (CVX_NAMES as $code => $text) {
        $exists = QueryUtils::fetchRecords(
            'SELECT id FROM codes WHERE code_type = ? AND code = ? LIMIT 1',
            [$ctId, (string) $code]
        );
        if (count($exists) === 0) {
            sqlStatement('INSERT INTO codes (code_type, code, code_text, active) VALUES (?, ?, ?, 1)', [$ctId, (string) $code, $text]);
        }
    }
}

/**
 * Seed immunizations for a patient (raw SQL — ImmunizationService::insert is
 * unimplemented). UuidRegistry::createUuid registers the uuid so the row is FHIR-
 * visible. Idempotent per (patient, cvx, date).
 *
 * @param list<array{0:string,1:string}> $vaccines list of [cvxCode, 'YYYY-MM-DD']
 */
function ensureImmunizations(int $pid, array $vaccines): void
{
    foreach ($vaccines as [$cvx, $date]) {
        $exists = QueryUtils::fetchRecords(
            'SELECT id FROM immunizations WHERE patient_id = ? AND cvx_code = ? AND DATE(administered_date) = ? LIMIT 1',
            [$pid, $cvx, $date]
        );
        if (count($exists) > 0) {
            continue;
        }
        $uuid = (new UuidRegistry(['table_name' => 'immunizations']))->createUuid();
        sqlStatement(
            'INSERT INTO immunizations
               (uuid, patient_id, administered_date, cvx_code, completion_status,
                added_erroneously, information_source, create_date, update_date)
             VALUES (?, ?, ?, ?, \'Completed\', 0, \'new_immunization_record\', NOW(), NOW())',
            [$uuid, $pid, $date . ' 09:00:00', $cvx]
        );
        echo "    immunization: " . (CVX_NAMES[$cvx] ?? $cvx) . " ({$date})\n";
    }
}

/** Print validation messages from a ProcessingResult and return whether it was valid. */
function ok(object $result, string $what): bool
{
    if (method_exists($result, 'isValid') && !$result->isValid()) {
        $msgs = method_exists($result, 'getValidationMessages') ? $result->getValidationMessages() : [];
        echo "    ! {$what} failed validation: " . json_encode($msgs) . "\n";
        return false;
    }
    return true;
}

echo "Seeding demo panel for provider " . PROVIDER_ID . " (today = " . date('Y-m-d') . ")\n\n";

foreach ($panel as $p) {
    $pid = findPid($p['fname'], $p['lname'], $p['dob']);
    if ($pid === null) {
        $res = $patientSvc->insert([
            'fname' => $p['fname'],
            'lname' => $p['lname'],
            'sex' => $p['sex'],
            'DOB' => $p['dob'],
            'providerID' => PROVIDER_ID,
        ]);
        if (!ok($res, 'patient')) {
            continue;
        }
        $row = $res->getData()[0];
        $pid = (int) $row['pid'];
        $uuid = (string) $row['uuid'];
        echo "{$p['fname']} {$p['lname']} — created pid={$pid}\n";

        foreach ($p['problems'] as $prob) {
            ok($condSvc->insert([
                'puuid' => $uuid,
                'title' => $prob['title'],
                'begdate' => $prob['begdate'],
                'diagnosis' => $prob['code'],
            ]), 'problem');
        }
        foreach ($p['allergies'] as $al) {
            ok($allergySvc->insert([
                'puuid' => $uuid,
                'title' => $al['title'],
                'begdate' => $al['begdate'],
                // Coded diagnosis so FHIR emits the real allergen, not "Unknown".
                'diagnosis' => $al['code'],
            ]), 'allergy');
        }
        foreach ($p['meds'] as $m) {
            ok($rxSvc->insert([
                'drug' => $m['drug'],
                'patient_id' => $pid,
                'active' => 1,
                'provider_id' => PROVIDER_ID,
                'date_added' => date('Y-m-d H:i:s'),
                'dosage' => $m['dosage'],
                'quantity' => '30',
            ]), 'medication');
        }
        echo "    " . count($p['problems']) . " problem(s), " . count($p['allergies'])
            . " allergy(ies), " . count($p['meds']) . " med(s)\n";
    } else {
        echo "{$p['fname']} {$p['lname']} — exists pid={$pid} (skip create)\n";
    }

    ensureApptToday($apptSvc, $pid, $p['time'], 'Follow-up visit');
}

// Immunizations on file for a few patients (idempotent; raw SQL + UuidRegistry).
echo "\nImmunizations:\n";
seedCvxCodes();
$immPlan = [
    'Alvarez' => [['140', '2025-10-01'], ['115', '2019-05-10']],
    'Fielding' => [['140', '2025-09-15'], ['33', '2022-03-01']],
    'Nguyen' => [['140', '2025-10-05']],
];
foreach ($panel as $p) {
    $pid = findPid($p['fname'], $p['lname'], $p['dob']);
    if ($pid !== null && isset($immPlan[$p['lname']])) {
        echo "{$p['fname']} {$p['lname']} — pid={$pid}\n";
        ensureImmunizations($pid, $immPlan[$p['lname']]);
    }
}

// Put the existing conflict-demo patient Susan (pid 2, med-status conflict) on today's
// schedule too, so the huddle showcases reconciliation.
echo "\nSusan Underwood — pid=2 (existing)\n";
ensureApptToday($apptSvc, 2, '08:45', 'Medication review');

echo "\nDone.\n";
