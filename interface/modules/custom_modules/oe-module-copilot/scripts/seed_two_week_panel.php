<?php

/**
 * Seed a richer two-week demo panel for the Clinical Co-Pilot.
 *
 * Extends seed_demo_panel.php to ~16 patients (the original 6 are kept + augmented),
 * each with problems / meds / allergies PLUS vital signs and condition-matched lab
 * results, and books ~2 appointments per patient across the next 14 days (weekdays)
 * so the calendar looks like a real clinic. All data is created via OpenEMR services
 * (or, where no service exists, raw SQL + UuidRegistry) so every row is UUID-registered
 * and visible through the FHIR API the agent reads. Synthetic/demo data only.
 *
 * FHIR-visibility notes (easy to miss):
 *  - Vitals: after inserting form_vitals + its forms row, you MUST call
 *    UuidMapping::createAllMissingResourceUuids() — the FHIR Observation ids for vitals
 *    come from uuid_mapping (one per LOINC code), not form_vitals.uuid.
 *  - Labs: no insert service exists; it's a raw-SQL chain
 *    procedure_order -> procedure_order_code -> procedure_report -> procedure_result,
 *    and the order_code row's seq must match the report seq or the join drops the result.
 *
 * Idempotent: skips patients that already exist (create-only fields), skips vitals/labs
 * for a patient that already has them, and skips appointments already on a given date.
 *
 * Run inside the openemr container:
 *   php interface/modules/custom_modules/oe-module-copilot/scripts/seed_two_week_panel.php
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
use OpenEMR\Common\Uuid\UuidMapping;
use OpenEMR\Common\Uuid\UuidRegistry;
use OpenEMR\Services\AllergyIntoleranceService;
use OpenEMR\Services\AppointmentService;
use OpenEMR\Services\ConditionService;
use OpenEMR\Services\EncounterService;
use OpenEMR\Services\PatientService;
use OpenEMR\Services\PrescriptionService;
use OpenEMR\Services\VitalsService;

const PROVIDER_ID = 6;          // Dr. Donna Lee (users.id)
const PROVIDER_USER = 'physician'; // users.username (FHIR performer join + form user)
const FACILITY_ID = 3;          // Great Clinic
const GROUP_NAME = 'Default';   // authorization group
const APPTS_PER_PATIENT = 2;    // visits booked across the next 14 days
const VDATE = '2026-07-08';     // date stamped on the seeded vitals + labs

// The vitals save fires a post-save event (VitalsCalculatedService) that reads the current
// user id from the session; in CLI there is none, so set it to the seeding provider to avoid
// a TypeError and let the derived-vitals calculation persist.
$_SESSION['authUserId'] = PROVIDER_ID;
$_SESSION['authUser'] = PROVIDER_USER;
$_SESSION['authProvider'] = GROUP_NAME;

/**
 * The full 16-patient panel. The first 6 mirror seed_demo_panel.php (kept + given
 * vitals/labs); the next 10 are new. `meds`/`problems`/`allergies` are applied only when
 * the patient is newly created; `vitals`/`labs` are applied when absent.
 *
 * @var list<array<string, mixed>>
 */
$panel = require __DIR__ . '/two_week_panel_data.php';

$patientSvc = new PatientService();
$condSvc = new ConditionService();
$allergySvc = new AllergyIntoleranceService();
$rxSvc = new PrescriptionService();
$apptSvc = new AppointmentService();

function findPatient(string $fname, string $lname, string $dob): ?array
{
    $rows = QueryUtils::fetchRecords(
        'SELECT pid, uuid FROM patient_data WHERE fname = ? AND lname = ? AND DOB = ? LIMIT 1',
        [$fname, $lname, $dob]
    );
    if (empty($rows)) {
        return null;
    }
    return ['pid' => (int) $rows[0]['pid'], 'uuid' => UuidRegistry::uuidToString($rows[0]['uuid'])];
}

/** Print ProcessingResult validation messages; return validity. */
function ok(object $result, string $what): bool
{
    if (method_exists($result, 'isValid') && !$result->isValid()) {
        $msgs = method_exists($result, 'getValidationMessages') ? $result->getValidationMessages() : [];
        echo "    ! {$what} failed validation: " . json_encode($msgs) . "\n";
        return false;
    }
    return true;
}

function hasVitals(int $pid): bool
{
    return count(QueryUtils::fetchRecords(
        "SELECT 1 FROM forms WHERE pid = ? AND formdir = 'vitals' AND deleted = 0 LIMIT 1",
        [$pid]
    )) > 0;
}

function hasLabs(int $pid): bool
{
    return count(QueryUtils::fetchRecords(
        'SELECT 1 FROM procedure_order WHERE patient_id = ? AND activity = 1 LIMIT 1',
        [$pid]
    )) > 0;
}

/** Create an encounter for the patient (returns eid) so vitals + labs can attach to it. */
function createEncounter(string $puuid): ?int
{
    $enc = (new EncounterService())->insertEncounter($puuid, [
        'date' => VDATE . ' 09:00:00',
        'provider_id' => PROVIDER_ID,
        'user' => PROVIDER_USER,
        'group' => GROUP_NAME,
        'reason' => 'Office visit — vitals + labs',
        'pc_catid' => 5,
        'facility_id' => FACILITY_ID,
        'class_code' => 'AMB',       // ambulatory (FHIR encounter class) — required by the validator
    ]);
    if (!ok($enc, 'encounter')) {
        return null;
    }
    return (int) $enc->getData()[0]['encounter'];
}

/** Save a vitals form for the encounter (US units: lb/in/degF/mmHg). */
function saveVitals(int $pid, int $eid, array $v): void
{
    (new VitalsService())->save([
        'pid' => $pid,
        'eid' => $eid,
        'user' => PROVIDER_USER,
        'authorized' => 1,
        'date' => VDATE . ' 09:00:00',
        'bps' => $v['bps'],
        'bpd' => $v['bpd'],
        'pulse' => $v['pulse'],
        'respiration' => $v['resp'],
        'temperature' => $v['temp_f'],
        'weight' => $v['weight_lb'],
        'height' => $v['height_in'],
        'oxygen_saturation' => $v['oxygen_sat'],
        'BMI' => $v['bmi'],
    ]);
}

/** Raw-SQL 4-table lab chain (no insert service exists). */
function insertLab(int $pid, int $eid, array $lab): void
{
    $ordered = VDATE . ' 08:00:00';
    $reported = VDATE . ' 10:00:00';
    $orderUuid = (new UuidRegistry(['table_name' => 'procedure_order']))->createUuid();
    $orderId = (int) sqlInsert(
        "INSERT INTO procedure_order
           (uuid, provider_id, patient_id, encounter_id, date_ordered, date_collected,
            order_status, activity, lab_id, procedure_order_type, order_intent)
         VALUES (?, ?, ?, ?, ?, ?, 'completed', 1, 0, 'laboratory_test', 'order')",
        [$orderUuid, PROVIDER_ID, $pid, $eid, $ordered, $ordered]
    );
    sqlStatement(
        "INSERT INTO procedure_order_code
           (procedure_order_id, procedure_order_seq, procedure_code, procedure_name,
            procedure_source, procedure_order_title, diagnoses)
         VALUES (?, 1, ?, ?, '1', ?, '')",
        [$orderId, $lab['loinc'], $lab['name'], $lab['name']]
    );
    $reportUuid = (new UuidRegistry(['table_name' => 'procedure_report']))->createUuid();
    $reportId = (int) sqlInsert(
        "INSERT INTO procedure_report
           (uuid, procedure_order_id, procedure_order_seq, date_collected, date_report,
            source, report_status, review_status)
         VALUES (?, ?, 1, ?, ?, ?, 'final', 'reviewed')",
        [$reportUuid, $orderId, $ordered, $reported, PROVIDER_ID]
    );
    $resultUuid = (new UuidRegistry(['table_name' => 'procedure_result']))->createUuid();
    sqlInsert(
        "INSERT INTO procedure_result
           (uuid, procedure_report_id, result_data_type, result_code, result_text,
            date, units, result, `range`, abnormal, result_status)
         VALUES (?, ?, 'N', ?, ?, ?, ?, ?, ?, ?, 'final')",
        [$resultUuid, $reportId, $lab['loinc'], $lab['name'], $reported,
         $lab['unit'], $lab['value'], ($lab['range'] ?? ''), ($lab['abnormal'] ?? 'normal')]
    );
}

function apptExistsOn(int $pid, string $date): bool
{
    return count(QueryUtils::fetchRecords(
        'SELECT 1 FROM openemr_postcalendar_events WHERE pc_pid = ? AND pc_eventDate = ? LIMIT 1',
        [$pid, $date]
    )) > 0;
}

function bookAppt(AppointmentService $svc, int $pid, string $date, string $time): void
{
    if (apptExistsOn($pid, $date)) {
        return;
    }
    $svc->insert($pid, [
        'pc_catid' => 5,
        'pc_title' => 'Office Visit',
        'pc_duration' => 900,
        'pc_hometext' => 'Follow-up visit',
        'pc_apptstatus' => '-',
        'pc_eventDate' => $date,
        'pc_startTime' => $time,
        'pc_facility' => FACILITY_ID,
        'pc_billing_location' => FACILITY_ID,
        'pc_aid' => PROVIDER_ID,
    ]);
}

// ---------------------------------------------------------------------------
echo "Seeding two-week panel for provider " . PROVIDER_ID . " (today = " . date('Y-m-d') . ")\n\n";

$allPids = [];
foreach ($panel as $p) {
    $found = findPatient($p['fname'], $p['lname'], $p['dob']);
    if ($found === null) {
        $res = $patientSvc->insert([
            'fname' => $p['fname'], 'lname' => $p['lname'],
            'sex' => $p['sex'], 'DOB' => $p['dob'], 'providerID' => PROVIDER_ID,
        ]);
        if (!ok($res, 'patient')) {
            continue;
        }
        $row = $res->getData()[0];
        $pid = (int) $row['pid'];
        $uuid = (string) $row['uuid'];
        echo "{$p['fname']} {$p['lname']} — created pid={$pid}\n";
        foreach ($p['problems'] as $prob) {
            ok($condSvc->insert(['puuid' => $uuid, 'title' => $prob['title'], 'begdate' => $prob['begdate'], 'diagnosis' => $prob['code']]), 'problem');
        }
        foreach ($p['allergies'] as $al) {
            ok($allergySvc->insert(['puuid' => $uuid, 'title' => $al['title'], 'begdate' => $al['begdate'], 'diagnosis' => $al['code']]), 'allergy');
        }
        foreach ($p['meds'] as $m) {
            ok($rxSvc->insert(['drug' => $m['drug'], 'patient_id' => $pid, 'active' => 1, 'provider_id' => PROVIDER_ID, 'date_added' => date('Y-m-d H:i:s'), 'dosage' => $m['dosage'], 'quantity' => '30']), 'medication');
        }
    } else {
        $pid = $found['pid'];
        $uuid = $found['uuid'];
        echo "{$p['fname']} {$p['lname']} — exists pid={$pid}\n";
    }
    $allPids[] = $pid;

    // Vitals + labs (gated together on the absence of a vitals form).
    if (!hasVitals($pid) && !empty($p['vitals'])) {
        $eid = createEncounter($uuid);
        if ($eid !== null) {
            saveVitals($pid, $eid, $p['vitals']);
            $labCount = 0;
            if (!hasLabs($pid)) {
                foreach (($p['labs'] ?? []) as $lab) {
                    insertLab($pid, $eid, $lab);
                    $labCount++;
                }
            }
            echo "    vitals ✓, {$labCount} lab(s)\n";
        }
    } else {
        echo "    vitals/labs: already present (skip)\n";
    }
}

// Mint the uuid_mapping rows that make the vitals FHIR-visible (one per LOINC/column).
UuidMapping::createAllMissingResourceUuids();
echo "\nuuid_mapping for vitals: refreshed\n";

// ---- Book ~2 appointments per patient across the next 14 days (weekdays) ----
echo "\nScheduling appointments across the next 14 days:\n";
$days = [];
for ($i = 1; $i <= 14; $i++) {
    $d = date('Y-m-d', strtotime("+{$i} day"));
    if ((int) date('N', strtotime($d)) <= 5) { // Mon–Fri
        $days[] = $d;
    }
}
$times = ['09:00:00', '09:30:00', '10:00:00', '10:30:00', '11:00:00', '13:30:00', '14:00:00', '14:30:00'];
$queue = [];
for ($k = 0; $k < APPTS_PER_PATIENT; $k++) {
    foreach ($allPids as $pid) {
        $queue[] = $pid;
    }
}
$perDay = (int) ceil(count($queue) / max(1, count($days)));
foreach ($queue as $idx => $pid) {
    $day = $days[intdiv($idx, $perDay)] ?? end($days);
    $time = $times[($idx % $perDay) % count($times)];
    bookAppt($apptSvc, $pid, $day, $time);
}
$booked = QueryUtils::fetchRecords(
    "SELECT COUNT(*) AS c FROM openemr_postcalendar_events WHERE pc_aid = ? AND pc_eventDate > CURDATE() AND pc_eventDate <= DATE_ADD(CURDATE(), INTERVAL 14 DAY)",
    [PROVIDER_ID]
);
echo "  appointments in the next 14 days: " . ($booked[0]['c'] ?? '?') . "\n";

echo "\nDone.\n";
