<?php

/**
 * Per-document review-decisions endpoint — each value's saved disposition for one document, so the
 * review UI shows committed vs dismissed state on reopen. In-session, ownership-scoped.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    Raych
 * @copyright Copyright (c) 2026 Raych
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

// globals.php bootstraps + enforces the authenticated OpenEMR session ($ignoreAuth stays false).
require_once(__DIR__ . "/../../../../globals.php");

use OpenEMR\Modules\Copilot\Controller\ReviewDecisionsController;

(new ReviewDecisionsController())->handle();
