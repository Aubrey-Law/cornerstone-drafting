# Lawmatics Appointment Synchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mirror native Cornerstone appointment creation, rescheduling, and cancellation into Lawmatics without making Lawmatics authoritative or sending duplicate client notifications.

**Architecture:** A corrected non-expiring OAuth token feeds a typed Lawmatics JSON:API client. A durable `lawmatics_sync_appointment` job resolves or creates the Prospect, converges one Lawmatics Event to current Cornerstone state, and records provider state through the shared integration repository.

**Tech Stack:** Next.js App Router, TypeScript, Supabase/Postgres, Lawmatics REST API, Vitest

**Spec:** `docs/superpowers/specs/2026-09-15-scheduler-lawmatics-statular-design.md`

## Global Constraints

- Complete `2026-09-15-scheduler-integrations-foundation.md` first.
- Cornerstone and Google Calendar remain authoritative.
- Synchronization is one-way and disabled by default.
- Lawmatics must not send attendee invitations or reminders.
- Preserve the existing Lawmatics intake import.
- Never expose access tokens or token prefixes in API responses or logs.

---

### Task 1: Correct Lawmatics OAuth storage and status

**Files:**
- Create: `supabase/migrations/20261204000000_lawmatics_nonexpiring_tokens.sql`
- Modify: `lib/lawmatics.ts`
- Modify: `app/api/lawmatics/callback/route.ts`
- Modify: `app/api/lawmatics/status/route.ts`
- Modify: `app/api/lawmatics/pull/route.ts`
- Modify: `tests/lawmatics-import.test.ts`
- Create: `tests/lawmatics-auth.test.ts`

**Interfaces:**
- Produces: `getLawmaticsAccessToken(): Promise<string>`.
- Produces: `exchangeCode(code): Promise<{ access_token: string }>`.
- Preserves: existing import exports consumed by `app/api/lawmatics/pull/route.ts`.

- [ ] **Step 1: Write failing authentication tests**

```ts
it('returns the stored access token without refresh or expiry checks', async () => {
  mocks.maybeSingle.mockResolvedValue({ data: { access_token: 'stored-token' }, error: null })
  await expect(getLawmaticsAccessToken()).resolves.toBe('stored-token')
  expect(fetch).not.toHaveBeenCalled()
})

it('does not expose token material from status', async () => {
  const response = await GET(adminRequest())
  const body = await response.json()
  expect(body).toMatchObject({ connected: true })
  expect(JSON.stringify(body)).not.toContain('stored-token')
  expect(body).not.toHaveProperty('token_preview')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/lawmatics-auth.test.ts tests/lawmatics-import.test.ts`

Expected: the new tests fail because current code fabricates expiry, supports refresh, and returns a token preview.

- [ ] **Step 3: Add the compatibility migration**

Make `lawmatics_tokens.expires_at` nullable. Leave `refresh_token` present and nullable so existing rows and rollback remain safe. Do not drop data.

- [ ] **Step 4: Simplify the OAuth client and callback**

Replace expiry/refresh behavior with a direct protected lookup:

```ts
export async function getLawmaticsAccessToken(): Promise<string> {
  const { data, error } = await getAdminClient()
    .from('lawmatics_tokens')
    .select('access_token')
    .eq('id', 'singleton')
    .maybeSingle()
  if (error) throw new Error('Lawmatics connection could not be read')
  if (!data?.access_token) throw new Error('Lawmatics is not connected')
  return data.access_token
}
```

Store `expires_at: null` and `refresh_token: null` in the callback. Keep constant-time OAuth state validation.

Update both calls in `app/api/lawmatics/pull/route.ts` to use
`getLawmaticsAccessToken()`. Preserve its current disconnected response and the
existing search/import functions.

- [ ] **Step 5: Return a safe status shape**

Return `{ connected, updatedAt, error? }`. Remove `expired`, `expires_at`, and `token_preview` from the route response.

- [ ] **Step 6: Run focused tests**

Run: `npx vitest run tests/lawmatics-auth.test.ts tests/lawmatics-import.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261204000000_lawmatics_nonexpiring_tokens.sql lib/lawmatics.ts app/api/lawmatics/callback/route.ts app/api/lawmatics/status/route.ts app/api/lawmatics/pull/route.ts tests/lawmatics-auth.test.ts tests/lawmatics-import.test.ts
git commit -m "fix: align Lawmatics OAuth token handling"
```

---

### Task 2: Add a typed Lawmatics request client

**Files:**
- Create: `lib/integrations/lawmatics/client.ts`
- Create: `lib/integrations/lawmatics/types.ts`
- Create: `tests/lawmatics-client.test.ts`

**Interfaces:**
- Produces: `lawmaticsRequest<T>(path, init): Promise<T>`.
- Produces: `createLawmaticsProspect(input)`, `createLawmaticsEvent(input)`, `updateLawmaticsEvent(id, input)`, and `cancelLawmaticsEvent(id)`.
- Consumes: `getLawmaticsAccessToken()` and normalized `IntegrationError`.

- [ ] **Step 1: Write failing transport tests**

Test bearer authorization, JSON:API headers, successful `data` parsing, a `429` response with `Retry-After: 7`, and a validation error whose raw body contains an email address.

```ts
await expect(lawmaticsRequest('/v1/events', { method: 'POST', body: {} }))
  .rejects.toMatchObject({
    provider: 'lawmatics',
    kind: 'retryable',
    code: 'rate_limited',
    retryAfterMs: 7000,
  })
```

Assert the normalized error and logger output do not contain the email or access token.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lawmatics-client.test.ts`

Expected: FAIL because the client does not exist.

- [ ] **Step 3: Implement the request client**

Use `https://api.lawmatics.com`, `Authorization: Bearer <token>`, JSON request bodies, and an abort timeout. Parse `Retry-After` as either seconds or an HTTP date. Classify network errors, `429`, and `5xx` as retryable; classify `401`, `403`, `404`, and `422` as attention errors with fixed safe messages.

- [ ] **Step 4: Implement focused API functions**

Use exact input types rather than passing database rows:

```ts
export interface LawmaticsEventInput {
  name: string
  description: string
  start: string
  end: string
  timezone: string
  prospectId: string
  eventTypeId: string
  userIds: string[]
  locationId?: string
}
```

The serializer sets `eventable_type: 'Prospect'`, emits the configured IDs, and disables provider invitations/reminders. Cancellation calls the documented event deletion endpoint without attendee notification.

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run tests/lawmatics-client.test.ts tests/lawmatics-auth.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/integrations/lawmatics/client.ts lib/integrations/lawmatics/types.ts tests/lawmatics-client.test.ts
git commit -m "feat: add Lawmatics API client"
```

---

### Task 3: Implement Prospect resolution and Event convergence

**Files:**
- Create: `lib/integrations/lawmatics/prospect.ts`
- Create: `lib/integrations/lawmatics/appointments.ts`
- Create: `tests/lawmatics-appointment-sync.test.ts`

**Interfaces:**
- Produces: `resolveLawmaticsProspect(appointmentId): Promise<string>`.
- Produces: `syncLawmaticsAppointment(appointmentId): Promise<IntegrationResult>`.
- Consumes: shared external-record repository, integration settings, and Lawmatics client.

- [ ] **Step 1: Write failing service tests**

Cover these exact cases:

- Existing neutral Prospect mapping is reused.
- A verified `client_intake.lawmatics_matter_id` mapping is reused for the same linked lead.
- Missing Prospect is created once and recorded.
- Scheduled appointment with no Event creates one.
- Changed start/end updates the existing Event.
- Cancelled appointment deletes the Event and records `cancelled`.
- Missing appointment-type mapping produces `attention/configuration_required`.
- A Calendly appointment is rejected as `attention/unsupported_source` without an API call.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lawmatics-appointment-sync.test.ts`

Expected: FAIL because the services do not exist.

- [ ] **Step 3: Implement Prospect resolution**

Resolve the stable `client_intake` ID from `appointments.linked_lead_id`, or from `appointments.linked_matter_id -> matters.client_intake_id`. Never select a record by email alone. Claim an external `prospect` row before creating; record the returned ID before returning.

- [ ] **Step 4: Implement appointment convergence**

Load the appointment, type, scheduling timezone, and integration mappings. Construct a source version from the appointment ID, status, start, end, type, location, mapped event type, mapped location, and assigned Lawmatics user IDs using SHA-256. If the recorded source version matches, return `reused` without an API call. Including mapping configuration ensures a corrected mapping converges the existing Event.

Use this decision table:

```ts
if (appointment.status === 'cancelled' && event.externalId) return cancelExistingEvent()
if (appointment.status === 'cancelled') return markCancelledWithoutCreate()
if (event.externalId) return updateExistingEvent()
return createEvent()
```

Never include manage tokens, private notes, or intake answers in the Event description.

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run tests/lawmatics-appointment-sync.test.ts tests/lawmatics-client.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/integrations/lawmatics/prospect.ts lib/integrations/lawmatics/appointments.ts tests/lawmatics-appointment-sync.test.ts
git commit -m "feat: synchronize appointments to Lawmatics"
```

---

### Task 4: Add durable Lawmatics jobs and booking hooks

**Files:**
- Create: `supabase/migrations/20261205000000_lawmatics_appointment_jobs.sql`
- Create: `lib/integrations/lawmatics/jobs.ts`
- Modify: `lib/workflowJobs.ts`
- Modify: `lib/appointments/book.ts`
- Modify: `tests/workflow-job-leases.test.ts`
- Modify: `tests/appointment-booking.test.ts`
- Create: `tests/lawmatics-jobs.test.ts`

**Interfaces:**
- Produces: workflow job type `lawmatics_sync_appointment`.
- Produces: `enqueueLawmaticsAppointmentSync(appointmentId, actorId?)`.
- Consumes: `syncLawmaticsAppointment(appointmentId)`.

- [ ] **Step 1: Write failing job and hook tests**

Assert booking, rescheduling, and cancellation enqueue a Lawmatics job only when enabled. Assert enqueue failure does not change the successful booking response. Assert a job payload contains only `appointmentId` and `sourceVersion`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/lawmatics-jobs.test.ts tests/appointment-booking.test.ts tests/workflow-job-leases.test.ts`

Expected: FAIL because the job type and hooks do not exist.

- [ ] **Step 3: Extend the database job-type check**

Replace the `workflow_jobs_job_type_check` constraint with the existing values plus `lawmatics_sync_appointment`. Preserve all rows and grants.

- [ ] **Step 4: Add the job dispatcher**

Extend `WorkflowJobType` and `runJob`:

```ts
if (job.job_type === 'lawmatics_sync_appointment') {
  const appointmentId = payload.appointmentId
  if (typeof appointmentId !== 'string') {
    throw new Error('lawmatics_sync_appointment requires appointmentId')
  }
  await syncLawmaticsAppointment(appointmentId)
  return
}
```

`enqueueLawmaticsAppointmentSync` checks the enablement flag and creates a dedupe key containing the appointment source version.

The runner checks enablement again immediately before any provider call. If disabled,
it records or retains `disabled` state and returns successfully. When
`syncLawmaticsAppointment` raises an `attention` error, the job persists that state
and returns successfully so the generic queue does not waste automatic attempts.
Only `retryable` errors are rethrown to the lease/backoff machinery.

- [ ] **Step 5: Add post-commit hooks**

Call the enqueue helper after a successful booking link, reschedule, and cancellation. Catch only enqueue failures, log the appointment ID and safe classification, and rely on reconciliation for repair.

- [ ] **Step 6: Run focused tests**

Run: `npx vitest run tests/lawmatics-jobs.test.ts tests/appointment-booking.test.ts tests/workflow-job-leases.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261205000000_lawmatics_appointment_jobs.sql lib/integrations/lawmatics/jobs.ts lib/workflowJobs.ts lib/appointments/book.ts tests/lawmatics-jobs.test.ts tests/appointment-booking.test.ts tests/workflow-job-leases.test.ts
git commit -m "feat: enqueue Lawmatics appointment synchronization"
```

---

### Task 5: Add Lawmatics reconciliation

**Files:**
- Create: `lib/integrations/lawmatics/reconcile.ts`
- Create: `app/api/cron/scheduler-integrations/route.ts`
- Create: `tests/lawmatics-reconcile.test.ts`

**Interfaces:**
- Produces: `reconcileLawmaticsAppointments(limit): Promise<{ scanned: number; enqueued: number }>`.
- Produces: CRON-protected `GET /api/cron/scheduler-integrations` shared later with Statular.

- [ ] **Step 1: Write failing reconciliation tests**

Assert the scanner selects only native appointments, caps the limit at 100, skips matching source versions, enqueues missing/changed states, and does nothing when disabled.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lawmatics-reconcile.test.ts`

Expected: FAIL because reconciliation does not exist.

- [ ] **Step 3: Implement the bounded scanner and route**

Use ordered keyset batches, not an unbounded table read. Authenticate the route with the existing `CRON_SECRET` bearer pattern. Return counts only; do not serialize appointments or provider errors.

- [ ] **Step 4: Run focused and scheduler regression tests**

```bash
npx vitest run \
  tests/lawmatics-auth.test.ts \
  tests/lawmatics-client.test.ts \
  tests/lawmatics-appointment-sync.test.ts \
  tests/lawmatics-jobs.test.ts \
  tests/lawmatics-reconcile.test.ts \
  tests/lawmatics-import.test.ts \
  tests/appointment-booking.test.ts \
  tests/calendar-sync-dispatch.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/lawmatics/reconcile.ts app/api/cron/scheduler-integrations/route.ts tests/lawmatics-reconcile.test.ts
git commit -m "feat: reconcile Lawmatics appointment mirrors"
```

---

### Task 6: Verify Lawmatics delivery

**Files:**
- Modify only if verification identifies a regression.

**Interfaces:**
- Produces: disabled-by-default, one-way Lawmatics appointment synchronization.

- [ ] **Step 1: Run static and full test checks**

Run: `npm run lint`

Run: `npm run typecheck`

Run: `npm test`

Expected: PASS or no new failures relative to clean `origin/main`.

- [ ] **Step 2: Run live synthetic acceptance only when credentials are authorized**

Create one synthetic appointment, reschedule it, then cancel it. Verify exactly one Lawmatics Event is converged through those states and no Lawmatics attendee email is delivered. Record the test Prospect/Event IDs for cleanup in Lawmatics.

- [ ] **Step 3: Review the diff and keep synchronization disabled**

Run: `git diff --check`

Run: `git status --short`

Expected: no unrelated files and `lawmatics_appointment_sync_enabled = false` until the live gate passes.
