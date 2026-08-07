<?php

/**
 * Source-document resolver endpoint — maps a chat citation's derived lab Observation back to the
 * FHIR id of the document it was extracted from, so the chat can show the source screenshot + box
 * (Week 2, w2-inline-source-viewer Slice B). READ-ONLY. Auth + DB live on the OpenEMR origin, so
 * only an in-session request reaches this; the sidecar agent never can.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    Raych
 * @copyright Copyright (c) 2026 Raych
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

// globals.php bootstraps + enforces the authenticated OpenEMR session ($ignoreAuth stays false).
require_once(__DIR__ . "/../../../../globals.php");

use OpenEMR\Modules\Copilot\Controller\SourceDocumentController;

(new SourceDocumentController())->handle();
