<?php

/**
 * Clinical Co-Pilot module bootstrap — loaded on every request when enabled.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    Raych
 * @copyright Copyright (c) 2026 Raych
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

use OpenEMR\Core\ModulesClassLoader;
use OpenEMR\Core\OEGlobalsBag;
use OpenEMR\Modules\Copilot\Bootstrap;

$classLoader = new ModulesClassLoader(OEGlobalsBag::getInstance()->getProjectDir());
$classLoader->registerNamespaceIfNotExists(
    'OpenEMR\\Modules\\Copilot\\',
    __DIR__ . DIRECTORY_SEPARATOR . 'src'
);

$eventDispatcher = OEGlobalsBag::getInstance()->getKernel()->getEventDispatcher();
(new Bootstrap($eventDispatcher))->subscribeToEvents();
