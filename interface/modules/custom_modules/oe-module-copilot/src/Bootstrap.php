<?php

/**
 * Clinical Co-Pilot module bootstrap class — the floating, patient-scoped chat widget.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    Raych
 * @copyright Copyright (c) 2026 Raych
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\Copilot;

use GuzzleHttp\Client;
use OpenEMR\BC\ServiceContainer;
use OpenEMR\Common\Acl\AclExtended;
use OpenEMR\Common\Acl\AclMain;
use OpenEMR\Common\Csrf\CsrfUtils;
use OpenEMR\Common\Database\QueryUtils;
use OpenEMR\Common\Session\SessionWrapperFactory;
use OpenEMR\Common\Uuid\UuidRegistry;
use OpenEMR\Core\OEGlobalsBag;
use OpenEMR\Events\Main\Tabs\RenderEvent;
use OpenEMR\Events\PatientDocuments\DocumentCreatedEvent;
use OpenEMR\Modules\Copilot\Service\SessionTokenMinter;
use Symfony\Component\EventDispatcher\EventDispatcherInterface;

final class Bootstrap
{
    private const MODULE_INSTALLATION_PATH = '/interface/modules/custom_modules/oe-module-copilot';

    /**
     * ACL role groups that see the floating widget. The co-pilot is a bedside clinical
     * tool, so it is shown to clinicians — not administrative/back-office logins. Gating
     * on the role group (not the "authorized" provider flag) is deliberate: in a stock
     * OpenEMR the admin account is also flagged authorized, so the flag doesn't
     * distinguish them, but the ACL group does (admin=Administrators, physician=Physicians).
     *
     * @var list<string>
     */
    private const CLINICAL_GROUPS = ['Physicians', 'Clinicians'];

    public function __construct(private readonly EventDispatcherInterface $eventDispatcher)
    {
    }

    public function subscribeToEvents(): void
    {
        // Inject the floating, patient-scoped widget into the persistent top shell so it
        // docks over every tab and re-binds as the physician navigates patients. The
        // co-pilot has no header menu entry: it is a bedside overlay on the open chart.
        $this->eventDispatcher->addListener(RenderEvent::EVENT_BODY_RENDER_POST, $this->renderFloatingWidget(...));
        // Week 2: when a document is uploaded, kick off co-pilot extraction so the review is ready
        // before the physician opens the chart (auto-ingest Part C).
        $this->eventDispatcher->addListener(DocumentCreatedEvent::EVENT_HANDLE, $this->onDocumentCreated(...));
    }

    /**
     * On an interactive PDF upload, fire-and-forget a request to the sidecar agent to extract +
     * cache that patient's documents, so the "Review Documents" modal opens instantly later. The
     * trigger is a **system** action (no physician in the loop), so it mints a confined
     * `system:ingest` token bound to the uploaded document's pid — the agent accepts that token
     * only at `/documents/extract`, never a read path. Everything is guarded: a failure here must
     * never break the upload.
     */
    public function onDocumentCreated(DocumentCreatedEvent $event): void
    {
        try {
            // Act only on interactive uploads of PDFs — ignore API/CCDA/portal creations + other types.
            if ($event->getSource() !== DocumentCreatedEvent::SOURCE_UPLOAD) {
                return;
            }
            if (strtolower($event->getMimeType()) !== 'application/pdf') {
                return;
            }
            $pid = $event->getPatientId();
            if ($pid <= 0) {
                return;
            }
            $secret = (string) (getenv('COPILOT_BRIDGE_SECRET') ?: '');
            if ($secret === '') {
                return; // fail-closed: no bridge secret, no trigger
            }
            $fhirId = $this->patientFhirId($pid);
            if ($fhirId === null) {
                return;
            }

            $session = SessionWrapperFactory::getInstance()->getActiveSession();
            $userIdValue = $session->get('authUserID');
            $userId = is_numeric($userIdValue) ? (int) $userIdValue : 0;
            if ($userId <= 0) {
                return; // the wire schema requires a positive user id
            }

            $token = (new SessionTokenMinter($secret))->mint([
                'user_id' => $userId,
                'pid' => $pid,
                'patient_fhir_id' => $fhirId,
                'correlation_id' => 'ingest-' . $event->getDocumentId(),
                'exp' => time() + 60,               // used immediately, server-to-server
                'subject' => 'system:ingest',       // confined principal (agent: /extract only)
            ]);
            $this->fireExtract($token);
        } catch (\Throwable $e) {
            // A document-upload side effect must never break the upload — swallow everything.
            ServiceContainer::getLogger()->error('copilot onDocumentCreated failed', ['error' => $e->getMessage()]);
        }
    }

    /** Resolve a pid to its FHIR Patient id (patient_data.uuid as a canonical string), or null. */
    private function patientFhirId(int $pid): ?string
    {
        $row = QueryUtils::querySingleRow('SELECT uuid FROM patient_data WHERE pid = ?', [$pid]);
        $uuid = is_array($row) ? ($row['uuid'] ?? null) : null;
        if (!is_string($uuid) || $uuid === '') {
            return null;
        }
        return UuidRegistry::uuidToString($uuid);
    }

    /**
     * Fire-and-forget POST to the agent's server-to-server extract endpoint. The agent returns 202
     * immediately (it extracts in the background), so this returns fast and never blocks the upload.
     * Uses the INTERNAL agent URL (the module runs inside the OpenEMR container and cannot reach the
     * browser-facing localhost URL); falls back to the browser URL only if unset.
     */
    private function fireExtract(string $token): void
    {
        $base = (string) (getenv('COPILOT_AGENT_INTERNAL_URL') ?: '');
        if ($base === '') {
            $base = (string) (getenv('COPILOT_AGENT_URL') ?: 'http://localhost:3040');
        }
        // The agent returns 202 immediately (it extracts in the background), so a very short timeout
        // keeps the upload from being held: worst case (agent down) adds ~0.4s, not seconds. A missed
        // trigger degrades to the modal's extract-on-open — the real guarantee. `http_errors:false`
        // so a non-2xx never throws; TLS verification stays on unless the internal URL is plaintext.
        try {
            (new Client())->post(rtrim($base, '/') . '/documents/extract', [
                'headers' => ['Authorization' => 'Bearer ' . $token, 'Content-Type' => 'application/json'],
                'body' => '{}',
                'connect_timeout' => 0.4,
                'timeout' => 1.0,
                'http_errors' => false,
                'verify' => str_starts_with($base, 'https://'),
            ]);
        } catch (\Throwable $e) {
            ServiceContainer::getLogger()->debug('copilot extract trigger failed', ['error' => $e->getMessage()]);
        }
    }

    /**
     * Render the floating co-pilot launcher + panel into the top document (echoed at
     * `main.body.render.post`). Gated by the same ACL the menu declares; the widget binds
     * to the currently-open patient client-side (`top.app_view_model…patient().pid()`) and
     * mints an ownership-checked token per pid — no patient selection in the widget.
     */
    public function renderFloatingWidget(RenderEvent $event): void
    {
        if (!AclMain::aclCheckCore('patients', 'demo')) {
            return;
        }

        $session = SessionWrapperFactory::getInstance()->getActiveSession();

        // Clinicians only — the co-pilot is a bedside tool, not an admin/back-office one.
        $authUser = $session->get('authUser');
        $username = is_string($authUser) ? $authUser : '';
        if ($username === '') {
            return;
        }
        $groups = AclExtended::aclGetGroupTitles($username);
        if (!is_array($groups)) {
            return;
        }
        $groupTitles = array_map('strval', $groups);
        if (array_intersect($groupTitles, self::CLINICAL_GROUPS) === []) {
            return;
        }

        // Config the widget's JS needs. `agentBase` must share the page scheme (no
        // https->http mixed content); prod injects the public agent subdomain.
        $agentBase = (string) (getenv('COPILOT_AGENT_URL') ?: 'http://localhost:3032');
        $moduleBase = OEGlobalsBag::getInstance()->getWebRoot() . self::MODULE_INSTALLATION_PATH;
        $csrfToken = CsrfUtils::collectCsrfToken(session: $session);

        require __DIR__ . '/../public/widget.php';
        // The Week-2 document-review launcher + modal shares the same config + clinician gating.
        require __DIR__ . '/../public/review-widget.php';
    }
}
