# Scheduler Integrations Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add disabled-by-default, provider-neutral persistence and server-side contracts for reliable scheduler integrations.

**Architecture:** A protected singleton stores non-secret connector configuration, while a service-only external-record table stores provider identity, frozen delivery snapshots, idempotency, and safe status. Focused repository modules expose those records without knowing Lawmatics or Statular transport details.

**Tech Stack:** Next.js App Router, TypeScript, Supabase/Postgres, Vitest

**Spec:** `docs/superpowers/specs/2026-09-15-scheduler-lawmatics-statular-design.md`

## Global Constraints

- Cornerstone and Google Calendar remain authoritative for appointments.
- Lawmatics and Statular remain independent and disabled by default.
- All schema changes are additive; retain existing Lawmatics compatibility columns.
- Provider credentials and request snapshots never reach browser code or ordinary logs.
- Do not modify drafting payload generation, design sheets, or document generation.
- Do not enable either connector in production in this plan.

---

### Task 1: Add integration persistence

**Files:**
- Create: `supabase/migrations/20261203000000_scheduler_integration_foundation.sql`
- Create: `tests/scheduler-integration-foundation.test.ts`
- Modify: `packages/db-types/src/supabase.generated.ts`

**Interfaces:**
- Produces: `public.integration_settings` singleton row with provider configuration.
- Produces: `public.integration_external_records` service-only delivery and identity rows.
- Produces: `IntegrationProvider`, `IntegrationEntityType`, `IntegrationRecordType`, and `IntegrationStatus` database values.

- [ ] **Step 1: Write the failing migration-source test**

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20261203000000_scheduler_integration_foundation.sql',
  'utf8',
)

describe('scheduler integration foundation migration', () => {
  it('ships both connectors disabled and keeps delivery records service-only', () => {
    expect(migration).toContain('lawmatics_appointment_sync_enabled boolean not null default false')
    expect(migration).toContain('statular_sync_enabled boolean not null default false')
    expect(migration).toContain('create table public.integration_external_records')
    expect(migration).toContain('alter table public.integration_external_records enable row level security')
    expect(migration).not.toMatch(/create policy[\s\S]+integration_external_records/i)
  })

  it('enforces one external record per internal entity and kind', () => {
    expect(migration).toContain(
      'unique (provider, internal_entity_type, internal_entity_id, external_record_type)',
    )
    expect(migration).toContain('request_snapshot jsonb')
    expect(migration).toContain('request_hash text')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/scheduler-integration-foundation.test.ts`

Expected: FAIL because the migration does not exist.

- [ ] **Step 3: Write the additive migration**

Create the singleton settings table with JSON constraints that require objects for both mapping columns and an array for `lawmatics_user_ids`. Include nullable `lawmatics_last_checked_at` and `lawmatics_last_check_error`; the latter stores only a fixed safe message, never a provider response. Create the external-record table with these checks:

```sql
provider text not null check (provider in ('lawmatics', 'statular')),
internal_entity_type text not null check (internal_entity_type in ('lead', 'matter', 'appointment')),
external_record_type text not null check (external_record_type in ('prospect', 'event', 'client', 'matter')),
status text not null default 'pending' check (status in ('pending', 'synced', 'attention', 'disabled')),
source_version text not null,
idempotency_key text not null,
request_snapshot jsonb,
request_hash text,
last_error_code text,
last_error_message text,
last_attempt_at timestamptz,
last_succeeded_at timestamptz,
metadata jsonb not null default '{}'::jsonb
```

Add `created_at`, `updated_at`, the four-column unique constraint, and a partial unique index on `(provider, external_record_type, external_id)` when `external_id is not null`. Enable RLS, grant table access only to `service_role`, insert singleton ID `1`, and notify PostgREST.

- [ ] **Step 4: Update generated Supabase types**

After applying migrations to local Supabase, generate types to a temporary file and
replace the generated source only after verifying the output:

```bash
npx supabase gen types typescript --local --schema public > /tmp/scheduler-integrations-supabase.generated.ts
rg -q "export type Database" /tmp/scheduler-integrations-supabase.generated.ts
mv /tmp/scheduler-integrations-supabase.generated.ts packages/db-types/src/supabase.generated.ts
```

Do not generate from the hosted project before the migration is deployed; its schema
cannot contain the pending tables.

- [ ] **Step 5: Run focused verification**

Run: `npx vitest run tests/scheduler-integration-foundation.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS or no new errors relative to a clean `origin/main` checkout.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261203000000_scheduler_integration_foundation.sql packages/db-types/src/supabase.generated.ts tests/scheduler-integration-foundation.test.ts
git commit -m "feat: add scheduler integration persistence"
```

---

### Task 2: Add normalized integration contracts

**Files:**
- Create: `lib/integrations/types.ts`
- Create: `lib/integrations/errors.ts`
- Create: `tests/integration-error-classification.test.ts`

**Interfaces:**
- Produces: `IntegrationProvider`, `IntegrationResult`, `IntegrationFailure`, and `IntegrationFailureKind`.
- Produces: `IntegrationError` and `safeIntegrationError(error)` for provider modules and job runners.

- [ ] **Step 1: Write the failing contract test**

```ts
import { describe, expect, it } from 'vitest'
import { IntegrationError, safeIntegrationError } from '@/lib/integrations/errors'

describe('integration errors', () => {
  it('exposes safe classification without leaking provider bodies', () => {
    const error = new IntegrationError({
      provider: 'statular',
      kind: 'attention',
      code: 'validation_failed',
      safeMessage: 'Statular rejected the client fields.',
      retryAfterMs: null,
    })
    expect(safeIntegrationError(error)).toEqual({
      provider: 'statular',
      kind: 'attention',
      code: 'validation_failed',
      message: 'Statular rejected the client fields.',
      retryAfterMs: null,
    })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration-error-classification.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement the contracts**

Define exact unions:

```ts
export type IntegrationProvider = 'lawmatics' | 'statular'
export type IntegrationFailureKind = 'retryable' | 'attention'
export type IntegrationStatus = 'pending' | 'synced' | 'attention' | 'disabled'

export interface IntegrationResult {
  provider: IntegrationProvider
  externalRecordType: 'prospect' | 'event' | 'client' | 'matter'
  externalId: string
  operation: 'created' | 'updated' | 'cancelled' | 'reused'
  metadata?: Record<string, string | number | boolean | null>
}
```

`IntegrationError` accepts only the normalized fields used in the test. Preserve the original error as `cause`, but never return it from `safeIntegrationError`.

- [ ] **Step 4: Run the focused test**

Run: `npx vitest run tests/integration-error-classification.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/types.ts lib/integrations/errors.ts tests/integration-error-classification.test.ts
git commit -m "feat: add scheduler integration contracts"
```

---

### Task 3: Add settings and external-record repositories

**Files:**
- Create: `lib/integrations/settings.ts`
- Create: `lib/integrations/records.ts`
- Create: `tests/integration-records.test.ts`

**Interfaces:**
- Produces: `getIntegrationSettings()` and `updateIntegrationSettings(input, actorId)`.
- Produces: `getExternalRecord(ref)`, `claimExternalRecord(input)`, `recordIntegrationSuccess(input)`, and `recordIntegrationFailure(input)`.
- Consumes: contracts from `lib/integrations/types.ts` and `lib/integrations/errors.ts`.

- [ ] **Step 1: Write failing repository tests with a mocked Supabase client**

Cover these assertions:

```ts
expect(await getIntegrationSettings()).toMatchObject({
  lawmaticsAppointmentSyncEnabled: false,
  statularSyncEnabled: false,
  lawmaticsEventTypeIdMap: {},
  statularDocIdMap: {},
})

expect(() => sanitizeDocIdMap({ 'EP:joint_trust': 0 })).toThrow('positive integer')
expect(sanitizeDocIdMap({ 'EP:joint_trust': 4 })).toEqual({ 'EP:joint_trust': 4 })
```

Test that `recordIntegrationFailure` stores only the normalized error code/message and that `recordIntegrationSuccess` clears the error and records the external ID.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration-records.test.ts`

Expected: FAIL because the repository modules do not exist.

- [ ] **Step 3: Implement settings validation**

Export `sanitizeProviderIdMap(value)`, `sanitizeDocIdMap(value)`, and `sanitizeProviderIds(value)`. Reject unknown top-level keys in the update input, trim string IDs, require positive integer Statular IDs, and write the singleton through `getAdminClient()`.

- [ ] **Step 4: Implement external-record claims and state updates**

Use the four-column unique key for upserts. Claims must preserve an already-synced `external_id`, reject a different request hash under the same idempotency key with `IntegrationError(code: 'idempotency_payload_conflict')`, and never log `request_snapshot`.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `npx vitest run tests/integration-records.test.ts tests/integration-error-classification.test.ts tests/scheduler-integration-foundation.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS or no new errors relative to clean baseline.

- [ ] **Step 6: Commit**

```bash
git add lib/integrations/settings.ts lib/integrations/records.ts tests/integration-records.test.ts
git commit -m "feat: add scheduler integration repositories"
```

---

### Task 4: Verify the foundation as an independent delivery

**Files:**
- Modify only if verification finds a foundation regression.

**Interfaces:**
- Produces: a disabled-by-default persistence and contract layer with no external calls.

- [ ] **Step 1: Run the complete focused suite**

```bash
npx vitest run \
  tests/scheduler-integration-foundation.test.ts \
  tests/integration-error-classification.test.ts \
  tests/integration-records.test.ts \
  tests/workflow-job-leases.test.ts \
  tests/appointment-booking.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run repository checks**

Run: `npm run lint`

Run: `npm run typecheck`

Run: `npm test`

Expected: PASS. If the checkout has known baseline failures, reproduce them in a clean `origin/main` worktree and require no new failures.

- [ ] **Step 3: Review the staged diff**

Run: `git diff --check`

Run: `git status --short`

Expected: no whitespace errors and no unrelated user files included.
