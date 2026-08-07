<?php

/**
 * Clinical Co-Pilot module information.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    Raych
 * @copyright Copyright (c) 2026 Raych
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

return [
    'name' => 'Clinical Co-Pilot',
    'description' => 'Bridges the logged-in provider to the Clinical Co-Pilot sidecar agent: mints a short-lived, HMAC-signed session token bound to a single patient the provider owns, and serves the embedded chat UI.',
    'version' => '1.0.0',
    'author' => 'Raych',
    'license' => 'GPL-3.0',
    'acl_category' => 'patients',
    'acl_section' => 'demo',

    'require' => [
        'openemr' => '>=7.0.0',
    ],

    // The bridge stores no state of its own (ownership is read from patient_data).
    'tables' => [],

    // No header menu entry: the co-pilot is a bedside overlay on the open chart, injected
    // as a floating widget by Bootstrap.php (main.body.render.post). (This module's menu is
    // registered via the Bootstrap event listeners, not this file — nothing loads
    // moduleConfig.php — so a 'menu' block here would be dead metadata anyway.)
];
