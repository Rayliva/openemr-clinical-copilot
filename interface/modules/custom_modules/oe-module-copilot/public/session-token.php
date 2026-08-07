<?php

/**
 * Session-token mint endpoint. Auth + DB live on the OpenEMR origin; only here can we
 * read the session and `patient_data`, so the sidecar agent (isolated network, no DB)
 * cannot mint its own token.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    Raych
 * @copyright Copyright (c) 2026 Raych
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

// Including globals.php bootstraps and enforces the authenticated OpenEMR session.
// `$ignoreAuth` stays false — an unauthenticated caller is redirected to login.
require_once(__DIR__ . "/../../../../globals.php");

use OpenEMR\Modules\Copilot\Controller\SessionTokenController;

(new SessionTokenController())->handle();
