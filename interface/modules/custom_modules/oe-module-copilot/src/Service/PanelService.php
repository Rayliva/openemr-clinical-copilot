<?php

/**
 * Provider panel + ownership lookups.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    Raych
 * @copyright Copyright (c) 2026 Raych
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\Copilot\Service;

use OpenEMR\Common\Database\QueryUtils;
use OpenEMR\Common\Uuid\UuidRegistry;

/**
 * Reads the set of patients a provider owns (`patient_data.providerID = users.id`).
 * This is the single row-level authorization control the whole design rests on: the
 * bridge mints a token only for a pid returned here, so the agent can never be pointed
 * at a chart outside the provider's panel (AUDIT.md §1.1, authorization-and-pid-scope).
 */
final class PanelService
{
    /**
     * @return list<array{pid:int, fhirId:string, name:string}>
     */
    public function ownedPatients(int $userId): array
    {
        if ($userId <= 0) {
            return [];
        }

        $rows = QueryUtils::fetchRecords(
            'SELECT pid, uuid, fname, lname FROM patient_data WHERE providerID = ? ORDER BY lname, fname',
            [$userId]
        );

        $patients = [];
        foreach ($rows as $row) {
            $uuid = $row['uuid'] ?? null;
            if (!is_string($uuid) || $uuid === '') {
                continue;
            }
            $pidValue = $row['pid'] ?? null;
            $fname = is_string($row['fname'] ?? null) ? $row['fname'] : '';
            $lname = is_string($row['lname'] ?? null) ? $row['lname'] : '';
            $patients[] = [
                'pid' => is_numeric($pidValue) ? (int) $pidValue : 0,
                'fhirId' => UuidRegistry::uuidToString($uuid),
                'name' => trim($fname . ' ' . $lname),
            ];
        }

        return $patients;
    }

    /**
     * The FHIR id for a pid **iff** the provider owns it, else null. This is the
     * ownership gate the mint endpoint enforces before issuing a token.
     */
    public function ownedPatientFhirId(int $userId, int $pid): ?string
    {
        return self::pickOwnedFhirId($this->ownedPatients($userId), $pid);
    }

    /**
     * Pure membership filter, split out so the ownership rule is unit-testable without
     * a database: return the FHIR id for `pid` iff it appears in the provider's panel,
     * else null (including for a non-positive pid).
     *
     * @param list<array{pid:int, fhirId:string, name:string}> $panel
     */
    public static function pickOwnedFhirId(array $panel, int $pid): ?string
    {
        if ($pid <= 0) {
            return null;
        }
        foreach ($panel as $patient) {
            if ($patient['pid'] === $pid) {
                return $patient['fhirId'];
            }
        }

        return null;
    }
}
