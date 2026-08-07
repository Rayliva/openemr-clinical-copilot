<?php

/**
 * Ownership-gate unit tests — the one control compensating for OpenEMR's role-level
 * API token (AUDIT.md §1.1). Regression guard: a non-owned pid must never resolve to a
 * FHIR id (which is what the mint endpoint would sign a token for).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    Raych
 * @copyright Copyright (c) 2026 Raych
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\Copilot\Tests\Unit;

use OpenEMR\Modules\Copilot\Service\PanelService;
use PHPUnit\Framework\TestCase;

final class PanelServiceTest extends TestCase
{
    /** @var list<array{pid:int, fhirId:string, name:string}> */
    private const PANEL = [
        ['pid' => 5, 'fhirId' => 'fhir-rosa', 'name' => 'Rosa Alvarez'],
        ['pid' => 6, 'fhirId' => 'fhir-harold', 'name' => 'Harold Kim'],
    ];

    public function testReturnsFhirIdForAnOwnedPid(): void
    {
        self::assertSame('fhir-rosa', PanelService::pickOwnedFhirId(self::PANEL, 5));
    }

    public function testRefusesAPidNotOnThePanel(): void
    {
        // pid 3 (Wanda Moore, unassigned) is not owned — must never resolve to a FHIR id.
        self::assertNull(PanelService::pickOwnedFhirId(self::PANEL, 3));
    }

    public function testRefusesANonPositivePid(): void
    {
        self::assertNull(PanelService::pickOwnedFhirId(self::PANEL, 0));
        self::assertNull(PanelService::pickOwnedFhirId(self::PANEL, -1));
    }

    public function testRefusesEveryPidAgainstAnEmptyPanel(): void
    {
        self::assertNull(PanelService::pickOwnedFhirId([], 5));
    }
}
