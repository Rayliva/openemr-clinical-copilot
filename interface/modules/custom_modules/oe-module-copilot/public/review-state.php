<?php

/**
 * Review-state endpoint — the FHIR ids of the documents the provider has fully reviewed for a
 * patient (Week 2 review workflow). In-session, ownership-scoped; the sidecar never reaches this.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    Raych
 * @copyright Copyright (c) 2026 Raych
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

// globals.php bootstraps + enforces the authenticated OpenEMR session ($ignoreAuth stays false).
require_once(__DIR__ . "/../../../../globals.php");

use OpenEMR\Modules\Copilot\Controller\ReviewStateController;

(new ReviewStateController())->handle();
