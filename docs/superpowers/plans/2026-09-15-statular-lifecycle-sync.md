# Statular Client and Matter Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create one Statular client from each confirmed native booking and one Statular matter when the related Cornerstone matter becomes hired.

**Architecture:** Cornerstone calls Statular's separate create-client and create-matter webhooks directly. Stable `client_intake` and matter identities, frozen request snapshots, webhook-generation-scoped idempotency keys, durable jobs, and package mappings prevent accidental duplicate creation and keep Statular independent from Lawmatics.

**Tech Stack:** Next.js App Router, React, TypeScript, Supabase/Postgres, Statular incoming webhooks, Vitest, Testing Library

**Spec:** `docs/superpowers/specs/2026-09-15-scheduler-lawmatics-statular-design.md`

## Global Constraints

- Complete `2026-09-15-scheduler-integrations-foundation.md` first.
- Statular is create-only; do not claim to update, delete, search, or reconcile by reading Statular.
- Client creation occurs after a confirmed native booking.
- Matter creation occurs after `matters.relationship_status` becomes `hired` and a valid package mapping exists.
- Statular never depends on a Lawmatics ID or delivery result.
- Webhook URLs stay server-only and are disabled by default.
- Preserve drafting and existing Statular Markdown export behavior.

---

### Task 1: Persist separate attendee names

**Files:**
- Create: `supabase/migrations/20261206000000_appointment_name_components.sql`
- Modify: `lib/appointments/types.ts`
- Modify: `lib/appointments/book.ts`
- Modify: `app/api/scheduling/book/route.ts`
- Modify: `components/scheduling/BookingWidget.tsx`
- Modify: `app/book/[slug]/page.tsx`
- Modify: `app/(portal)/schedule/SchedulePageClient.tsx`
- Modify: `app/admin/calendar/QuickBookPopover.tsx`
- Modify: `tests/appointment-booking.test.ts`
- Create: `tests/booking-name-fields.test.tsx`

**Interfaces:**
- Produces: `attendee_first_name`, `attendee_last_name`, `second_attendee_first_name`, and `second_attendee_last_name` appointment columns.
- Changes: `BookAppointmentInput` requires `attendeeFirstName` and `attendeeLastName`; combined names remain derived display fields.

- [ ] **Step 1: Write failing API and component tests**

```ts
it('requires separate primary names', async () => {
  const response = await POST(bookRequest({ firstName: 'Jane', lastName: '' }))
  expect(response.status).toBe(400)
  await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('lastName') })
})

it('submits separate names and spouse names', async () => {
  render(<BookingWidget type={type} />)
  expect(screen.getByLabelText('First name')).toBeTruthy()
  expect(screen.getByLabelText('Last name')).toBeTruthy()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/appointment-booking.test.ts tests/booking-name-fields.test.tsx`

Expected: FAIL because the API and form still use one `name` field.

- [ ] **Step 3: Add nullable compatibility columns**

Create the four nullable name columns. Do not backfill by splitting historical display names. Add comments stating that new writes require components at the application boundary.

- [ ] **Step 4: Update booking types and server validation**

Accept `firstName`, `lastName`, `secondAttendeeFirstName`, and `secondAttendeeLastName`. Trim and cap each at 80 characters. Construct display names with:

```ts
const attendeeName = `${firstName} ${lastName}`.replace(/\s+/g, ' ').trim()
```

Portal session email remains authoritative. `createLeadFromAppointment` writes the supplied components directly instead of splitting a full name.

- [ ] **Step 5: Update public, portal, and staff booking forms**

Change `BookingWidgetProps` to accept `defaultFirstName` and `defaultLastName`. Use two labeled inputs. When a portal profile only supplies a combined historical name, prefill first name with the combined value and require the client to confirm a last name; do not silently persist a guessed split. Apply the same component fields to spouse and Quick Book inputs.

- [ ] **Step 6: Run focused tests**

Run: `npx vitest run tests/appointment-booking.test.ts tests/booking-name-fields.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261206000000_appointment_name_components.sql lib/appointments/types.ts lib/appointments/book.ts app/api/scheduling/book/route.ts components/scheduling/BookingWidget.tsx 'app/book/[slug]/page.tsx' 'app/(portal)/schedule/SchedulePageClient.tsx' app/admin/calendar/QuickBookPopover.tsx tests/appointment-booking.test.ts tests/booking-name-fields.test.tsx
git commit -m "feat: collect booking name components"
```

---

### Task 2: Add the Statular webhook client

**Files:**
- Create: `lib/integrations/statular/config.ts`
- Create: `lib/integrations/statular/client.ts`
- Create: `lib/integrations/statular/types.ts`
- Create: `tests/statular-client.test.ts`
- Modify: `VERCEL_ENV_CHECKLIST.md`

**Interfaces:**
- Produces: `getStatularConfig()`.
- Produces: `createStatularClient(payload, idempotencyKey)` and `createStatularMatter(payload, idempotencyKey)`.
- Consumes: normalized `IntegrationError`.

- [ ] **Step 1: Write failing configuration and transport tests**

Cover missing URLs/generation, URL redaction, exact payloads, `201 { id }`, idempotent replay, concurrent `409`, payload-conflict `409`, `401`, `403`, `422`, `429`, `5xx`, and timeout.

```ts
expect(fetch).toHaveBeenCalledWith(
  'https://api.statular.com/webhooks/v1/stat_whk_test',
  expect.objectContaining({
    method: 'POST',
    headers: expect.objectContaining({
      'Content-Type': 'application/json',
      'Idempotency-Key': 'cornerstone:statular:client:lead-1:v1',
    }),
  }),
)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/statular-client.test.ts`

Expected: FAIL because the Statular client does not exist.

- [ ] **Step 3: Implement server-only configuration**

Read and validate:

```ts
STATULAR_CLIENT_WEBHOOK_URL
STATULAR_MATTER_WEBHOOK_URL
STATULAR_WEBHOOK_GENERATION
```

Require HTTPS and `api.statular.com` in production. Return only `{ clientConfigured, matterConfigured, generationConfigured }` from any public status helper; keep URLs in a server-only object.

- [ ] **Step 4: Implement exact webhook payloads**

Define allow-listed types matching the supplied documentation. Reject unknown keys before fetch. Parse only a positive string/number `id` from a `201` response. Never include the URL or response body in thrown safe messages.

Classify `429` and `5xx` as retryable; `401`, `403`, and `422` as attention. For `409`, compare the stored request hash: matching hash is retryable after a short delay, differing hash is `idempotency_payload_conflict`.

- [ ] **Step 5: Document environment variables**

Add all three variables to `VERCEL_ENV_CHECKLIST.md`, including the instruction to increment `STATULAR_WEBHOOK_GENERATION` whenever either URL rotates.

- [ ] **Step 6: Run focused tests**

Run: `npx vitest run tests/statular-client.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/integrations/statular/config.ts lib/integrations/statular/client.ts lib/integrations/statular/types.ts tests/statular-client.test.ts VERCEL_ENV_CHECKLIST.md
git commit -m "feat: add Statular webhook client"
```

---

### Task 3: Build and create Statular client records

**Files:**
- Create: `lib/integrations/statular/clientPayload.ts`
- Create: `lib/integrations/statular/clients.ts`
- Create: `tests/statular-client-sync.test.ts`

**Interfaces:**
- Produces: `buildStatularClientPayload(clientIntakeId): Promise<StatularClientPayload>`.
- Produces: `syncStatularClient(clientIntakeId): Promise<IntegrationResult>`.
- Consumes: Statular webhook client and external-record repository.

- [ ] **Step 1: Write failing payload and synchronization tests**

Cover individual, couple/partner, address, children, missing required names, exact allow-listed output, existing external record reuse, and successful ID persistence. Assert no intake field outside the documented Statular payload is emitted.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/statular-client-sync.test.ts`

Expected: FAIL because the builder and synchronization service do not exist.

- [ ] **Step 3: Implement payload assembly**

Read the stable `client_intake` row and related spouse/children data through existing intake structures. Normalize dates as `YYYY-MM-DD`, omit absent optional fields, and map child relationship only to `joint`, `settlor1`, or `settlor2`.

Return an attention error for missing first/last name instead of inventing `Unknown` values.

- [ ] **Step 4: Freeze and deliver the request**

Serialize the payload with stable key ordering, compute SHA-256, and claim the `statular/client` external row with:

```ts
const idempotencyKey = `cornerstone:statular:client:${clientIntakeId}:${config.generation}`
```

If `external_id` already exists, return `reused`. Otherwise reuse the stored snapshot/hash on retries, call the client webhook, and record the returned ID before success.

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run tests/statular-client-sync.test.ts tests/statular-client.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/integrations/statular/clientPayload.ts lib/integrations/statular/clients.ts tests/statular-client-sync.test.ts
git commit -m "feat: create Statular clients from bookings"
```

---

### Task 4: Enqueue Statular client creation after booking

**Files:**
- Create: `supabase/migrations/20261207000000_statular_client_jobs.sql`
- Create: `lib/integrations/statular/jobs.ts`
- Modify: `lib/workflowJobs.ts`
- Modify: `lib/appointments/book.ts`
- Modify: `tests/appointment-booking.test.ts`
- Create: `tests/statular-jobs.test.ts`

**Interfaces:**
- Produces: workflow job type `statular_create_client`.
- Produces: `enqueueStatularClientForAppointment(appointmentId)`.
- Consumes: `syncStatularClient(clientIntakeId)`.

- [ ] **Step 1: Write failing job tests**

Assert a confirmed native booking with a linked lead enqueues one client job, repeat booking uses the same `client_intake` dedupe identity, disabled Statular enqueues nothing, Calendly enqueues nothing, and enqueue failure does not fail the booking.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/statular-jobs.test.ts tests/appointment-booking.test.ts`

Expected: FAIL because the job type and hook do not exist.

- [ ] **Step 3: Extend the job-type constraint and worker**

Add `statular_create_client` to the existing job check. The runner requires `clientIntakeId` and invokes `syncStatularClient`.

- [ ] **Step 4: Add the booking enqueue helper**

Resolve `clientIntakeId` from the booking's explicit linked lead or matter. Use:

```ts
dedupeKey: `statular-client:${clientIntakeId}:${generation}`
payload: { clientIntakeId }
```

Call it only after booking and linkage succeed.

The runner checks Statular enablement and server configuration again before calling
the provider. Disabled jobs return successfully with `disabled` delivery state.
`attention` failures are persisted and treated as a completed queue job; only
`retryable` failures are rethrown for automatic backoff.

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run tests/statular-jobs.test.ts tests/appointment-booking.test.ts tests/workflow-job-leases.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261207000000_statular_client_jobs.sql lib/integrations/statular/jobs.ts lib/workflowJobs.ts lib/appointments/book.ts tests/statular-jobs.test.ts tests/appointment-booking.test.ts
git commit -m "feat: enqueue Statular clients after booking"
```

---

### Task 5: Resolve Statular document packages

**Files:**
- Create: `lib/integrations/statular/packageKey.ts`
- Modify: `lib/integrations/settings.ts`
- Create: `tests/statular-package-map.test.ts`

**Interfaces:**
- Produces: `resolveStatularPackageKey(matterId): Promise<string | null>`.
- Produces: `resolveStatularDocId(matterId): Promise<number>`.
- Consumes: existing plan normalization helpers and `integration_settings.statular_doc_id_map`.

- [ ] **Step 1: Write failing mapping tests**

Cover normalized estate-plan keys, practice-area prefixing, explicit non-estate mappings, positive-integer validation, missing plan, and missing map entries.

```ts
expect(packageKey({ practiceArea: 'EP', normalizedPlanType: 'joint_trust' }))
  .toBe('EP:joint_trust')
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/statular-package-map.test.ts`

Expected: FAIL because mapping resolution does not exist.

- [ ] **Step 3: Implement read-only plan resolution**

Prefer the attorney-selected normalized design plan for estate-planning matters, then the normalized intake legal plan. Do not write or seed drafting data. For other practice areas, require an explicit normalized legal-plan key.

Throw `IntegrationError(code: 'configuration_required')` when either the plan key or `doc_id` mapping is absent.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run tests/statular-package-map.test.ts tests/integration-records.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/statular/packageKey.ts lib/integrations/settings.ts tests/statular-package-map.test.ts
git commit -m "feat: map Cornerstone plans to Statular packages"
```

---

### Task 6: Create Statular matters on hiring

**Files:**
- Create: `supabase/migrations/20261208000000_statular_matter_jobs.sql`
- Create: `lib/integrations/statular/matterPayload.ts`
- Create: `lib/integrations/statular/matters.ts`
- Modify: `lib/integrations/statular/jobs.ts`
- Modify: `lib/workflowJobs.ts`
- Create: `tests/statular-matter-sync.test.ts`
- Create: `tests/integration/statular-hiring-trigger.test.ts`

**Interfaces:**
- Produces: workflow job type `statular_create_matter`.
- Produces: `syncStatularMatter(matterId): Promise<IntegrationResult>`.
- Produces: database trigger that enqueues on transition to `relationship_status = 'hired'` when Statular is enabled.

- [ ] **Step 1: Write failing service and trigger tests**

Cover successful client dependency reuse, missing client creation dependency, package resolution, matter payload, missing mapping attention state, exactly one job on hiring transition, no job while disabled, and no duplicate job on unrelated hired-matter edits.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/statular-matter-sync.test.ts`

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/statular-hiring-trigger.test.ts`

Expected: FAIL because the service, job type, and trigger do not exist.

- [ ] **Step 3: Add the hiring trigger and job type**

Add `statular_create_matter` to the job constraint. Create an `AFTER UPDATE OF relationship_status` trigger guarded by:

```sql
new.relationship_status = 'hired'
and old.relationship_status is distinct from 'hired'
and (select statular_sync_enabled from public.integration_settings where id = 1)
```

Insert a dedupe key based on `new.id` and the configured webhook generation supplied by the application reconciliation path. Because environment values are unavailable to SQL, the trigger's initial key is `statular-matter:<matter-id>:pending`; the worker replaces delivery idempotency with the configured generation in the external-record claim.

- [ ] **Step 4: Implement matter delivery**

Resolve `matters.client_intake_id`; call `syncStatularClient` first when no client external ID exists; resolve `doc_id`; construct `{ client_id, doc_id, state: 'MA', matter_name, drafter_id? }`; freeze/hash it; then call the matter webhook with:

```ts
const idempotencyKey = `cornerstone:statular:matter:${matterId}:${config.generation}`
```

Record the returned matter ID before job completion.

- [ ] **Step 5: Treat dependencies and configuration correctly**

A retryable client job failure keeps the matter job retryable. Missing plan or mapping records `attention/configuration_required` without consuming all attempts. No provider call occurs until the client ID and `doc_id` exist.

The matter runner repeats the enablement/configuration check used by the client job.
An `attention` result completes the generic workflow job after persisting attention
state; a retryable provider or dependency failure is rethrown.

- [ ] **Step 6: Run focused tests**

Run: `npx vitest run tests/statular-matter-sync.test.ts tests/statular-jobs.test.ts tests/workflow-job-leases.test.ts`

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/statular-hiring-trigger.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261208000000_statular_matter_jobs.sql lib/integrations/statular/matterPayload.ts lib/integrations/statular/matters.ts lib/integrations/statular/jobs.ts lib/workflowJobs.ts tests/statular-matter-sync.test.ts tests/integration/statular-hiring-trigger.test.ts
git commit -m "feat: create Statular matters when hired"
```

---

### Task 7: Add Statular reconciliation

**Files:**
- Create: `lib/integrations/statular/reconcile.ts`
- Modify: `app/api/cron/scheduler-integrations/route.ts`
- Create: `tests/statular-reconcile.test.ts`

**Interfaces:**
- Produces: `reconcileStatularRecords(limit): Promise<{ clients: number; matters: number }>`.
- Extends: scheduler-integration cron route with independent Lawmatics and Statular counts.

- [ ] **Step 1: Write failing reconciliation tests**

Assert confirmed native appointments missing client records are enqueued, repeat appointments collapse to one `client_intake` identity, hired/mapped matters are enqueued, configuration gaps become attention rather than repeated outbound attempts, a newly added mapping creates a new configuration-version job, and disabled Statular does nothing.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/statular-reconcile.test.ts`

Expected: FAIL because Statular reconciliation does not exist.

- [ ] **Step 3: Implement bounded keyset scans**

Cap each provider scan at 100 records. Enqueue through existing helpers and return counts only. A matter job dedupe key includes matter ID, webhook generation, package key, and mapped `doc_id`, so correcting configuration creates one new job without changing Statular's stable provider idempotency key. Invoke Lawmatics and Statular reconciliation independently so one provider failure does not stop the other.

- [ ] **Step 4: Run the Statular and scheduler suites**

```bash
npx vitest run \
  tests/statular-client.test.ts \
  tests/statular-client-sync.test.ts \
  tests/statular-package-map.test.ts \
  tests/statular-matter-sync.test.ts \
  tests/statular-jobs.test.ts \
  tests/statular-reconcile.test.ts \
  tests/appointment-booking.test.ts \
  tests/statular-export.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/statular/reconcile.ts app/api/cron/scheduler-integrations/route.ts tests/statular-reconcile.test.ts
git commit -m "feat: reconcile Statular lifecycle delivery"
```

---

### Task 8: Verify Statular delivery

**Files:**
- Modify only if verification identifies a regression.

**Interfaces:**
- Produces: disabled-by-default direct Statular creation independent of Lawmatics.

- [ ] **Step 1: Run repository checks**

Run: `npm run lint`

Run: `npm run typecheck`

Run: `npm test`

Expected: PASS or no new failures relative to clean `origin/main`.

- [ ] **Step 2: Run authorized synthetic acceptance**

With test webhook URLs, book one individual and one couple, repeat one booking, and hire each using a configured package. Verify two clients total, no duplicate from the repeated booking, and one correctly packaged matter per hired record.

- [ ] **Step 3: Exercise failure recovery**

Use a revoked test webhook, confirm an attention state without secret leakage, replace the URL and generation, retry, and verify successful ID persistence. Keep `statular_sync_enabled = false` in production until this gate passes.

- [ ] **Step 4: Review the diff**

Run: `git diff --check`

Run: `git status --short`

Expected: no unrelated files, no drafting changes, and no webhook URL committed.
