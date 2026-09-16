# Scheduler Integrations Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give staff safe configuration, status, recovery, and record-level visibility for the Lawmatics and Statular scheduler connectors.

**Architecture:** Authorized App Router endpoints expose only validated non-secret settings and safe delivery projections. A focused settings component manages connector flags and ID mappings, while existing calendar, lead, and matter surfaces render independent provider status badges and retry links.

**Tech Stack:** Next.js App Router, React, TypeScript, Supabase/Postgres, shadcn/ui, Vitest, Testing Library

**Spec:** `docs/superpowers/specs/2026-09-15-scheduler-lawmatics-statular-design.md`

## Global Constraints

- Complete the foundation, Lawmatics, and Statular plans first.
- Never serialize OAuth tokens, Statular webhook URLs, request snapshots, or raw provider bodies.
- Lawmatics and Statular settings and failures remain independent.
- Connector enablement must fail closed when required configuration is missing.
- Existing user changes in matter-detail files must be preserved and reconciled, not overwritten.
- No connector is enabled automatically by a migration or deployment.

---

### Task 1: Add authorized integration settings and status routes

**Files:**
- Create: `app/api/admin/scheduling/integrations/route.ts`
- Create: `app/api/admin/scheduling/integrations/reconcile/route.ts`
- Create: `app/api/admin/scheduling/integrations/status/route.ts`
- Create: `app/api/admin/scheduling/integrations/lawmatics/check/route.ts`
- Create: `app/api/admin/scheduling/integrations/lawmatics/disconnect/route.ts`
- Create: `tests/scheduling-integrations-route.test.ts`

**Interfaces:**
- Produces: `GET /api/admin/scheduling/integrations` safe settings/configuration shape.
- Produces: `PUT /api/admin/scheduling/integrations` validated settings updates.
- Produces: `GET /api/admin/scheduling/integrations/status` bounded safe delivery rows.
- Produces: `POST /api/admin/scheduling/integrations/reconcile` authorized enqueue-only reconciliation.
- Produces: Lawmatics check and local-disconnect actions.

- [ ] **Step 1: Write failing route tests**

Cover unauthorized requests, safe GET serialization, rejected unknown keys, rejected connector enablement with missing configuration, valid Lawmatics maps, valid Statular `doc_id` maps, disabling either provider, bounded status results, and manual reconciliation.

```ts
expect(JSON.stringify(await response.json())).not.toMatch(
  /access_token|request_snapshot|stat_whk_|client_secret/i,
)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/scheduling-integrations-route.test.ts`

Expected: FAIL because the routes do not exist.

- [ ] **Step 3: Implement safe response types**

Return:

```ts
interface SchedulingIntegrationsResponse {
  lawmatics: {
    connected: boolean
    enabled: boolean
    eventTypeIdMap: Record<string, string>
    locationIdMap: Record<string, string>
    userIds: string[]
  }
  statular: {
    enabled: boolean
    clientConfigured: boolean
    matterConfigured: boolean
    generationConfigured: boolean
    docIdMap: Record<string, number>
    drafterId: string | null
  }
}
```

No other database columns or environment values may be spread into the response.

- [ ] **Step 4: Implement validation and fail-closed enablement**

Both connectors require `firm_settings.durable_workflow_jobs_enabled = true` before
enablement. Lawmatics additionally requires a stored access token, at least one
event-type mapping, and at least one user ID. Statular additionally requires both
URLs, generation, and at least one document-package mapping. Return `409` with a safe
configuration message when requirements are absent.

After a successful Statular mapping update, invoke enqueue-only Statular
reconciliation so eligible `configuration_required` matters receive a new
configuration-version job immediately.

- [ ] **Step 5: Implement bounded status and manual reconciliation**

Status accepts `provider`, `status`, and `limit` with a hard maximum of 100. Select only IDs, provider, entity references, status, attempts/timestamps, and safe error fields. Manual reconciliation calls enqueue-only scanners and never invokes a provider inline.

The Lawmatics check action performs one bounded authenticated API probe and writes
`lawmatics_last_checked_at` plus a fixed safe error. The disconnect action disables
Lawmatics appointment sync and deletes only the singleton token; it preserves
external-record mappings and never affects Statular.

- [ ] **Step 6: Run focused tests**

Run: `npx vitest run tests/scheduling-integrations-route.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/api/admin/scheduling/integrations/route.ts app/api/admin/scheduling/integrations/reconcile/route.ts app/api/admin/scheduling/integrations/status/route.ts app/api/admin/scheduling/integrations/lawmatics/check/route.ts app/api/admin/scheduling/integrations/lawmatics/disconnect/route.ts tests/scheduling-integrations-route.test.ts
git commit -m "feat: add scheduler integration administration routes"
```

---

### Task 2: Add the scheduling integrations settings panel

**Files:**
- Create: `app/admin/settings/SchedulingIntegrationsSection.tsx`
- Modify: `app/admin/settings/StaffSettingsClient.tsx`
- Create: `tests/scheduling-integrations-settings.test.tsx`

**Interfaces:**
- Consumes: scheduling integration GET/PUT/status/reconcile routes.
- Produces: independent Lawmatics and Statular configuration panels.

- [ ] **Step 1: Write failing UI tests**

Cover loading state, safe connection state, enablement validation, mapping edits, independent toggles, direct-vs-native Statular warning, reconciliation button, and failed-delivery list.

```ts
expect(screen.getByText('Lawmatics appointment mirror')).toBeTruthy()
expect(screen.getByText('Statular client and matter creation')).toBeTruthy()
expect(screen.getByText(/must not both be enabled/i)).toBeTruthy()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/scheduling-integrations-settings.test.tsx`

Expected: FAIL because the panel does not exist.

- [ ] **Step 3: Implement focused provider panels**

Render Lawmatics connected/enabled state, event-type mappings keyed by appointment type, location mappings keyed by `phone|teams|in_person`, and comma-separated user IDs. Render Statular configuration booleans, package-key/positive-`doc_id` rows, drafter ID, and the duplicate-handoff warning.

Do not render URL or token inputs. The environment configuration status is read-only.

- [ ] **Step 4: Add operational controls**

Render failed/attention rows with entity links, attempt count, safe error, and last attempt. Reuse `POST /api/admin/workflow-jobs/[id]/retry` only for rows that have a retryable workflow job; use manual reconciliation after fixing configuration-required records.

- [ ] **Step 5: Run the UI test**

Run: `npx vitest run tests/scheduling-integrations-settings.test.tsx tests/scheduling-integrations-route.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/admin/settings/SchedulingIntegrationsSection.tsx app/admin/settings/StaffSettingsClient.tsx tests/scheduling-integrations-settings.test.tsx
git commit -m "feat: add scheduler integration settings"
```

---

### Task 3: Show independent provider state on appointments, leads, and matters

**Files:**
- Create: `components/integrations/IntegrationStatusBadge.tsx`
- Modify: `app/api/admin/scheduling/calendar-events/route.ts`
- Modify: `app/admin/calendar/types.ts`
- Modify: `app/admin/calendar/EventPrepDrawer.tsx`
- Modify: `app/admin/leads/[id]/page.tsx`
- Modify: `app/admin/leads/[id]/LeadDetailClient.tsx`
- Modify: `app/admin/matters/[id]/page.tsx`
- Modify: `app/admin/matters/[id]/MatterDetailClient.tsx`
- Create: `tests/integration-status-badge.test.tsx`
- Modify: `tests/calendar-view-mapping.test.ts`
- Modify: `tests/lead-detail-loader.test.ts`
- Modify: `tests/matter-detail-overview.test.ts`
- Modify: `tests/responsive-detail-layout.test.tsx`

**Interfaces:**
- Produces: `IntegrationStatusBadge({ provider, status, message?, syncedAt? })`.
- Extends: calendar event JSON with `lawmaticsIntegration` safe projection.
- Extends: lead/matter detail data with Statular client/matter safe projections.

- [ ] **Step 1: Write failing component and data-shape tests**

Assert separate Google/Lawmatics status in appointment details, separate Statular client/matter status in lead and matter details, accessible labels, no request snapshots, and no shared failure state.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/integration-status-badge.test.tsx tests/calendar-view-mapping.test.ts`

Expected: FAIL because safe projections and badges do not exist.

- [ ] **Step 3: Implement the shared badge**

Map statuses to labels without relying on color alone:

```ts
const LABEL = {
  pending: 'Pending',
  synced: 'Synced',
  attention: 'Needs attention',
  disabled: 'Disabled',
} as const
```

Render provider name and label in visible text; put safe error detail in adjacent text or tooltip.

- [ ] **Step 4: Add server-side safe projections**

Fetch only the matching external-record fields needed by each surface. Do not use `select('*')`. Batch queries by displayed IDs to avoid per-row queries in calendar/list views.

- [ ] **Step 5: Integrate with existing surfaces carefully**

Re-read current matter-detail files before editing because they contain user work in the originating checkout. Preserve their layout and behavior, then add the smallest integration-status block consistent with the current component structure.

- [ ] **Step 6: Run focused UI and route tests**

Run:

```bash
npx vitest run \
  tests/integration-status-badge.test.tsx \
  tests/calendar-view-mapping.test.ts \
  tests/lead-detail-loader.test.ts \
  tests/matter-detail-overview.test.ts \
  tests/responsive-detail-layout.test.tsx
```

Expected: PASS with no snapshot or responsive regressions.

- [ ] **Step 7: Commit**

Stage only these files, then commit:

```bash
git add components/integrations/IntegrationStatusBadge.tsx app/api/admin/scheduling/calendar-events/route.ts app/admin/calendar/types.ts app/admin/calendar/EventPrepDrawer.tsx 'app/admin/leads/[id]/page.tsx' 'app/admin/leads/[id]/LeadDetailClient.tsx' 'app/admin/matters/[id]/page.tsx' 'app/admin/matters/[id]/MatterDetailClient.tsx' tests/integration-status-badge.test.tsx tests/calendar-view-mapping.test.ts tests/lead-detail-loader.test.ts tests/matter-detail-overview.test.ts tests/responsive-detail-layout.test.tsx
git commit -m "feat: show scheduler integration status"
```

---

### Task 4: Correct stale Outlook language

**Files:**
- Modify: `app/admin/settings/SchedulingSettingsSection.tsx`
- Modify: `lib/appointments/book.ts`
- Create: `supabase/migrations/20261209000000_google_scheduler_comments.sql`
- Create: `tests/scheduling-provider-copy.test.ts`
- Modify: `tests/appointment-booking.test.ts`

**Interfaces:**
- Produces: Google-accurate or provider-neutral scheduler wording.

- [ ] **Step 1: Write failing copy assertions**

Assert the settings and confirmation source no longer contains `Outlook busy times`, `Outlook calendar invitation`, or `Outlook-backed`, and that user-visible language says `connected Google calendars` or `calendar invitation` as appropriate.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/scheduling-provider-copy.test.ts tests/appointment-booking.test.ts`

Expected: FAIL on current Outlook wording.

- [ ] **Step 3: Replace stale user-visible copy**

Keep historical Microsoft compatibility behavior and columns intact. Change only descriptions that claim the native scheduler currently uses Outlook.

- [ ] **Step 4: Correct database comments additively**

Use `COMMENT ON TABLE public.appointments` in the new migration. Do not modify the already-applied 202608 migration.

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run tests/scheduling-provider-copy.test.ts tests/appointment-booking.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/admin/settings/SchedulingSettingsSection.tsx lib/appointments/book.ts supabase/migrations/20261209000000_google_scheduler_comments.sql tests/scheduling-provider-copy.test.ts tests/appointment-booking.test.ts
git commit -m "fix: describe Google-backed scheduling accurately"
```

---

### Task 5: Complete end-to-end verification and rollout checklist

**Files:**
- Create: `docs/operations/scheduler-integrations-runbook.md`
- Modify: `VERCEL_ENV_CHECKLIST.md` if an operational requirement is missing.

**Interfaces:**
- Produces: safe configuration, verification, rotation, disablement, and recovery instructions.

- [ ] **Step 1: Write the runbook**

Document:

- Lawmatics Developer App creation and callback URL.
- Lawmatics event-type, user, and location ID mapping.
- Creation of one Statular client webhook and one matter webhook.
- Server-only environment variables and webhook-generation rotation.
- Package-key to `doc_id` mapping.
- Synthetic booking/reschedule/cancel/hire test sequence.
- How to inspect and retry safe failures.
- How to disable Lawmatics without disabling Statular.
- Warning against simultaneously enabling Statular's native Lawmatics handoff.
- Rollback: disable flags first; preserve external IDs and audit rows.

- [ ] **Step 2: Run the complete focused suite**

```bash
npx vitest run \
  tests/scheduler-integration-foundation.test.ts \
  tests/integration-error-classification.test.ts \
  tests/integration-records.test.ts \
  tests/lawmatics-auth.test.ts \
  tests/lawmatics-client.test.ts \
  tests/lawmatics-appointment-sync.test.ts \
  tests/lawmatics-jobs.test.ts \
  tests/lawmatics-reconcile.test.ts \
  tests/statular-client.test.ts \
  tests/statular-client-sync.test.ts \
  tests/statular-package-map.test.ts \
  tests/statular-matter-sync.test.ts \
  tests/statular-jobs.test.ts \
  tests/statular-reconcile.test.ts \
  tests/appointment-booking.test.ts \
  tests/calendar-sync-dispatch.test.ts \
  tests/lawmatics-import.test.ts \
  tests/statular-export.test.ts
```

Expected: all pass.

- [ ] **Step 3: Run repository-wide checks**

Run: `npm run lint`

Run: `npm run typecheck`

Run: `npm test`

Run: `npm run build`

Expected: PASS. For any pre-existing failure, compare against a clean `origin/main` worktree and document the exact equivalence.

- [ ] **Step 4: Perform browser verification**

Using local browser fixtures, verify settings validation, mapping edits, independent provider status, manual reconciliation, failed-state accessibility, public booking with separate names, portal booking, Quick Book, rescheduling, and cancellation.

- [ ] **Step 5: Perform authorized live provider verification**

Use synthetic recipients only. Verify Lawmatics create/reschedule/cancel without duplicate email; Statular individual, couple, repeat-booking, hire, package mapping, revoked-secret recovery, and Lawmatics-disabled/Statular-enabled behavior.

- [ ] **Step 6: Keep production disabled pending evidence review**

Confirm both database flags remain false. Present automated, browser, and live-provider evidence for owner approval before enabling either connector.

- [ ] **Step 7: Commit documentation**

```bash
git add docs/operations/scheduler-integrations-runbook.md VERCEL_ENV_CHECKLIST.md
git commit -m "docs: add scheduler integration runbook"
```
