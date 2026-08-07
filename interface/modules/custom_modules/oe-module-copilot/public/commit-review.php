<?php

/**
 * Commit-review endpoint — persists the physician's accepted extracted values to the chart as
 * FHIR-visible Observations (Week 2 slice 2f, the only write in the system). Auth + DB live on the
 * OpenEMR origin, so only an in-session request reaches this; the sidecar agent never can.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    Raych
 * @copyright Copyright (c) 2026 Raych
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

// globals.php bootstraps + enforces the authenticated OpenEMR session ($ignoreAuth stays false).
require_once(__DIR__ . "/../../../../globals.php");

use OpenEMR\Modules\Copilot\Controller\CommitReviewController;

(new CommitReviewController())->handle();
