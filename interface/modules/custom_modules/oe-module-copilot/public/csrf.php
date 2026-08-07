<?php

/**
 * Fresh-CSRF endpoint — returns a CSRF token for the CURRENT OpenEMR session.
 *
 * The review UI captures a CSRF token when the page/shell first rendered; if OpenEMR later rotates
 * the session id, that token stops verifying and the commit fails "csrf verification failed". The
 * commit handler GETs this right before writing so it always sends a token matching the live session.
 * globals.php enforces the authenticated session (so only an in-session request reaches this), and a
 * CSRF token is safe to return to same-origin JS (cross-origin callers cannot read the response).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    Raych
 * @copyright Copyright (c) 2026 Raych
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

require_once(__DIR__ . "/../../../../globals.php");

use OpenEMR\Common\Csrf\CsrfUtils;
use OpenEMR\Common\Session\SessionWrapperFactory;

header('Content-Type: application/json');

$session = SessionWrapperFactory::getInstance()->getActiveSession();
echo json_encode(['csrf' => CsrfUtils::collectCsrfToken(session: $session)], JSON_THROW_ON_ERROR);
