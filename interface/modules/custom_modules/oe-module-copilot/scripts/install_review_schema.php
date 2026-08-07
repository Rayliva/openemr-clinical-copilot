<?php

/**
 * Install (idempotently) the Clinical Co-Pilot document-review tables (Week 2 review workflow).
 *
 * The review workflow is the module's first persisted state: per-value physician dispositions
 * (accepted / discarded) and a per-document "reviewed" flag. This module is manually enabled and
 * deployed by bind-mount + `git pull`, so — like the seed scripts — schema is applied by a small
 * idempotent CLI setup run once per site (both blue/green droplets). `CREATE TABLE IF NOT EXISTS`
 * makes re-runs a no-op.
 *
 * Run inside the openemr container:
 *   php interface/modules/custom_modules/oe-module-copilot/scripts/install_review_schema.php
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    Raych
 * @copyright Copyright (c) 2026 Raych
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

if (php_sapi_name() !== 'cli') {
    die("This install script is CLI-only.\n");
}

$_GET['site'] = $argv[1] ?? 'default';
$ignoreAuth = true;
$sessionAllowWrite = true;
require_once __DIR__ . '/../../../../globals.php';

use OpenEMR\Common\Database\QueryUtils;

// One live disposition per (document, value): a re-commit updates it (see ReviewDecisionStore).
QueryUtils::sqlStatementThrowException(
    "CREATE TABLE IF NOT EXISTS `copilot_review_decision` (
        `id` INT NOT NULL AUTO_INCREMENT,
        `document_id` INT NOT NULL,
        `value_key` VARCHAR(191) NOT NULL,
        `disposition` VARCHAR(16) NOT NULL,
        `decided_value` VARCHAR(255) NOT NULL DEFAULT '',
        `user_id` INT NOT NULL,
        `updated_at` DATETIME NOT NULL,
        PRIMARY KEY (`id`),
        UNIQUE KEY `uniq_doc_value` (`document_id`, `value_key`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
);

// A document is 'reviewed' once every extracted value has a disposition; the launcher hides it then.
QueryUtils::sqlStatementThrowException(
    "CREATE TABLE IF NOT EXISTS `copilot_document_review` (
        `document_id` INT NOT NULL,
        `pid` INT NOT NULL,
        `reviewed` TINYINT NOT NULL DEFAULT 0,
        `user_id` INT NOT NULL,
        `updated_at` DATETIME NOT NULL,
        PRIMARY KEY (`document_id`),
        KEY `idx_pid_reviewed` (`pid`, `reviewed`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
);

echo "copilot review-workflow tables installed (copilot_review_decision, copilot_document_review).\n";
