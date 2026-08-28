# Remove the CRM Campaign System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the in-house drip email marketing system (~2,100 LOC, 6 tables, 1 RPC, 2 crons, 3 webhooks/public routes) while preserving every marketing-consent record and keeping already-sent unsubscribe links working.

**Architecture:** Two separate pull requests, in order. **PR 1 removes application code only** and leaves every database object in place. **PR 2, merged no earlier than 30 days after the last campaign send, drops the tables.** They are split because merging a migration to `main` triggers `db-migrate-deploy.yml` while Vercel ships the code independently, in no guaranteed order — so a drop that lands before its code is gone takes production down. This is the additive-then-deferred-drop discipline documented in `supabase/migrations/README.md`.

The consent model survives the removal untouched: `cornerstone_crm_people.marketing_status` / `consent_source` / `consent_captured_at` / `unsubscribed_at` / `campaign_opt_out`, `lib/crm/consent.ts`, `components/crm/MarketingProfileCard.tsx`, and `app/api/admin/crm/profiles/[intakeId]/route.ts` all stay. They are read by the matter detail page and the matter messages tab, and they are the firm's durable record of who opted out.

**Tech Stack:** Next.js App Router, TypeScript, Supabase Postgres, Vitest, Mailgun (being removed).

---

## Compliance constraint — read before starting

`app/api/unsubscribe/[token]/route.ts` resolves an unsubscribe token by looking up `cornerstone_crm_campaign_deliveries.delivery_token_hash`. **Every unsubscribe link in every campaign email ever sent points at that endpoint.** Dropping the deliveries table makes those links return 404.

CAN-SPAM (16 CFR 316.5) requires an unsubscribe mechanism to remain functional for **at least 30 days** after a message is sent. Task 1 establishes whether any campaign has ever been sent, which decides everything downstream:

- **Nothing ever sent** → no live links exist; Task 6 deletes the unsubscribe route and PR 2 can follow immediately.
- **Something sent** → the unsubscribe route and the `cornerstone_crm_campaign_deliveries` table stay until 30 days after the last send; Task 6 keeps a reduced route and PR 2 is scheduled, not immediate.

Do not skip Task 1. Do not guess the answer.

---

## File Structure

**Deleted (PR 1) — 2,106 LOC:**

| Path | LOC | Responsibility |
|---|---|---|
| `app/admin/settings/campaigns/page.tsx` | 19 | Campaign list page |
| `app/admin/settings/campaigns/CampaignsClient.tsx` | 571 | Campaign list + audience builder UI |
| `app/admin/settings/campaigns/[id]/page.tsx` | 33 | Campaign detail page |
| `app/admin/settings/campaigns/[id]/CampaignDetailClient.tsx` | 434 | Step editor, recipient stats |
| `app/api/admin/crm/campaigns/route.ts` | 162 | List/create campaigns |
| `app/api/admin/crm/campaigns/[id]/route.ts` | 182 | Read/update/delete a campaign |
| `app/api/admin/crm/campaigns/[id]/queue/route.ts` | 213 | Resolve audience → recipients |
| `app/api/admin/crm/campaigns/[id]/run/route.ts` | 32 | Manual dispatch trigger |
| `app/api/admin/crm/campaigns/[id]/steps/route.ts` | 54 | Campaign step CRUD |
| `app/api/cron/crm-campaigns/route.ts` | 16 | Daily dispatcher |
| `app/api/webhooks/mailgun/route.ts` | 82 | Mailgun delivery events (campaign-only) |
| `lib/crm/campaignDispatch.ts` | 180 | Claim, batch, send, suppress |
| `lib/crm/campaignPolicy.ts` | 31 | Consent gate + event mapping |
| `lib/crm/mailgunCampaigns.ts` | 60 | Mailgun HTTP client, token hashing |
| `tests/crm-campaign-policy.test.ts` | 26 | Tests for deleted policy module |
| `app/api/unsubscribe/[token]/route.ts` | 11 | **Conditional — see Task 6** |

**Modified (PR 1):**

| Path | Change |
|---|---|
| `lib/queries/cornerstoneCrm.ts` | Strip campaign types/queries (~200 of 638 lines); keep people/stages/dashboard |
| `app/admin/settings/StaffSettingsClient.tsx:48` | Remove the Campaigns tab |
| `next.config.mjs:26-27` | Remove the two `/admin/crm/campaigns` redirects |
| `vercel.json` | Remove the `crm-campaigns` cron entry |
| `tests/crm-hub.test.ts` | Invert campaign assertions to assert absence |
| `VERCEL_ENV_CHECKLIST.md:164-168` | Remove the five `MAILGUN_*` rows |

**Preserved deliberately — do not touch:**

`lib/crm/consent.ts` · `lib/crm/dashboard.ts` · `components/crm/MarketingProfileCard.tsx` · `app/api/admin/crm/profiles/[intakeId]/route.ts` · all `cornerstone_crm_people` consent columns.

**Created (PR 2):**

`supabase/migrations/<timestamp>_drop_crm_campaign_tables.sql`

---

## Task 1: Establish the compliance facts

> **Task 1 result (2026-08-27):** campaigns=0, recipients=0, deliveries=0,
> deliveries_attempted=0, last_send_at=null.
> → **Branch A: never sent.** No live unsubscribe links exist. The unsubscribe
> route is deleted in Task 6; Task 2's export is a no-op because there are no
> rows; PR 2 (Task 10) is unblocked and needs no retention wait.

**Files:** none — this is a read-only production query whose answer shapes Tasks 6 and 9.

- [ ] **Step 1: Run the send-history query against the shared firm database**

Open the Supabase SQL editor for the production project and run:

```sql
select
  (select count(*) from public.cornerstone_crm_campaigns)              as campaigns,
  (select count(*) from public.cornerstone_crm_campaign_recipients)    as recipients,
  (select count(*) from public.cornerstone_crm_campaign_deliveries)    as deliveries,
  (select count(*) from public.cornerstone_crm_campaign_deliveries
     where provider_status is not null
       and provider_status <> 'queued')                                as deliveries_attempted,
  (select max(last_event_at) from public.cornerstone_crm_campaign_deliveries) as last_send_at,
  (select count(*) from public.cornerstone_crm_people
     where marketing_status = 'opted_out')                             as opted_out_people;
```

- [ ] **Step 2: Record the answer at the top of this plan file**

Append the result under this task as a dated note, e.g.:

```markdown
> **Task 1 result (2026-08-27):** campaigns=0, recipients=0, deliveries=0,
> deliveries_attempted=0, last_send_at=null, opted_out_people=3.
> → Never sent. Unsubscribe route may be deleted in Task 6. PR 2 unblocked.
```

- [ ] **Step 3: Choose the branch**

- `deliveries_attempted = 0` → **Branch A (never sent).**
- `deliveries_attempted > 0` → **Branch B (sent).** Record `last_send_at + 30 days` as the earliest PR 2 merge date.

`opted_out_people` is informational: it confirms how many consent records the preserved columns are protecting. It must be unchanged when you re-run this query after PR 2.

- [ ] **Step 4: Commit the recorded result**

```bash
git add docs/superpowers/plans/2026-08-27-remove-crm-campaigns.md
git commit -m "docs: record campaign send history before removal"
```

---

## Task 2: Export the campaign data to cold storage

**Files:** none in-repo — exports go to the firm's document store, never to git.

Even on Branch A this runs: campaign copy and audience rules are firm work product, and the events table is the only record of past delivery outcomes.

- [ ] **Step 1: Export each table to CSV**

In the Supabase SQL editor, run each query and use "Download CSV" for each result:

```sql
select * from public.cornerstone_crm_campaigns             order by created_at;
select * from public.cornerstone_crm_campaign_steps        order by campaign_id, id;
select * from public.cornerstone_crm_campaign_recipients   order by campaign_id, id;
select * from public.cornerstone_crm_campaign_deliveries   order by campaign_id, id;
select * from public.cornerstone_crm_campaign_dispatches   order by campaign_id, id;
select * from public.cornerstone_crm_campaign_events       order by created_at;
```

- [ ] **Step 2: Store the six CSVs**

Save to the firm's retention store under `Firm Administration / Cornerstone / campaign-archive-2026-08/`. These contain client email addresses — they must not be committed to the repository, placed in `public/`, or attached to a PR.

- [ ] **Step 3: Verify row counts match Task 1**

Open each CSV and confirm its row count equals the corresponding count from Task 1's query. A short export means the download truncated; re-run it before proceeding.

No commit — nothing changed in the repo.

---

## Task 3: Invert the structural tests

`tests/crm-hub.test.ts` currently asserts the campaign UI and API **exist**. Changing these assertions first, and watching them fail, is what proves the later deletions actually happened.

**Files:**
- Modify: `tests/crm-hub.test.ts:19-45`, `:47-60`, `:61-68`, `:70-89`

- [ ] **Step 1: Replace the "moves campaigns and sync into Settings" test**

Replace the whole `it('moves campaigns and sync into Settings without touching their API routes', ...)` block (lines 19–45) with:

```typescript
  it('has no campaign UI or API surface', () => {
    const subnav = read('app/admin/crm/CrmSubnav.tsx')
    expect(subnav).not.toContain('/admin/crm/campaigns')
    expect(subnav).not.toContain('/admin/crm/sync')

    // Sync stays in Settings; campaigns are gone entirely.
    expect(fs.existsSync(path.join(process.cwd(), 'app/admin/settings/sync/page.tsx'))).toBe(true)
    const settings = read('app/admin/settings/StaffSettingsClient.tsx')
    expect(settings).toContain('/admin/settings/sync')
    expect(settings).not.toContain('/admin/settings/campaigns')

    for (const gone of [
      'app/admin/settings/campaigns',
      'app/api/admin/crm/campaigns',
      'app/api/cron/crm-campaigns',
      'app/api/webhooks/mailgun',
      'lib/crm/campaignDispatch.ts',
      'lib/crm/campaignPolicy.ts',
      'lib/crm/mailgunCampaigns.ts',
    ]) {
      expect(fs.existsSync(path.join(process.cwd(), gone))).toBe(false)
    }
  })

  it('keeps the marketing consent record that outlives campaigns', () => {
    // Consent is a compliance record, not campaign machinery: the matter page
    // and messages tab read it to gate nurture email.
    expect(fs.existsSync(path.join(process.cwd(), 'lib/crm/consent.ts'))).toBe(true)
    expect(fs.existsSync(path.join(process.cwd(), 'components/crm/MarketingProfileCard.tsx'))).toBe(true)
    expect(read('app/admin/matters/[id]/page.tsx')).toContain('normalizeMarketingConsent')
  })
```

- [ ] **Step 2: Remove the two campaign redirect assertions**

In `it('preserves legacy lead and contact URLs with framework redirects', ...)`, delete these two lines:

```typescript
      expect.objectContaining({ source: '/admin/crm/campaigns', destination: '/admin/settings/campaigns' }),
      expect.objectContaining({ source: '/admin/crm/campaigns/:path*', destination: '/admin/settings/campaigns/:path*' }),
```

- [ ] **Step 3: Fix the "authoritative source views" test**

Replace the whole `it('uses authoritative source views for People and campaign eligibility', ...)` block with:

```typescript
  it('uses the authoritative source view for People', () => {
    expect(read('app/admin/crm/people/page.tsx')).toContain('fetchContactsDirectory')
    expect(fs.existsSync(path.join(process.cwd(), 'app/api/admin/crm/import-leads/route.ts'))).toBe(false)
  })
```

- [ ] **Step 4: Drop the campaign clauses from the migration-shape test**

In `it('expands, backfills, and bridges CRM writes idempotently', ...)`, delete these five lines:

```typescript
    expect(migration).toContain("('public.cornerstone_crm_campaign_steps'::regclass, 'campaign steps', false)")
    expect(migration).toContain('cornerstone_crm_campaign_deliveries_step_idx')
    expect(migration).toContain('Campaign recipient snapshots are immutable')
    expect(read('app/api/admin/crm/campaigns/[id]/queue/route.ts')).toContain('snapshot_email: person.email')
    expect(read('lib/crm/campaignDispatch.ts')).toContain('email: snapshotEmail')
```

Leave every other assertion in that block. They cover CRM people/opportunities/activities, which are staying.

- [ ] **Step 5: Run the test to verify it fails**

```bash
npx vitest run tests/crm-hub.test.ts
```

Expected: FAIL. `has no campaign UI or API surface` fails on the first `expect(fs.existsSync(...)).toBe(false)` because the files are still there.

- [ ] **Step 6: Commit the failing test**

```bash
git add tests/crm-hub.test.ts
git commit -m "test: assert campaign surface is absent before removing it"
```

---

## Task 4: Delete the campaign UI and its entry points

**Files:**
- Delete: `app/admin/settings/campaigns/` (4 files)
- Modify: `app/admin/settings/StaffSettingsClient.tsx:48`
- Modify: `next.config.mjs:24-27`

- [ ] **Step 1: Delete the campaign pages**

```bash
git rm -r "app/admin/settings/campaigns"
```

- [ ] **Step 2: Remove the Settings tab**

In `app/admin/settings/StaffSettingsClient.tsx`, delete line 48:

```typescript
  { href: '/admin/settings/campaigns', label: 'Campaigns' },
```

- [ ] **Step 3: Remove the redirects**

In `next.config.mjs`, delete these four lines from the `redirects()` array (the comment goes too, since it describes only campaigns and sync):

```javascript
      // Campaigns and Sync moved out of the CRM workspace into Settings. Campaigns
      // keeps a :path* entry because it has an [id] child; Sync has no children.
      { source: '/admin/crm/campaigns', destination: '/admin/settings/campaigns', permanent: true },
      { source: '/admin/crm/campaigns/:path*', destination: '/admin/settings/campaigns/:path*', permanent: true },
```

Replace with a comment covering what remains:

```javascript
      // Sync moved out of the CRM workspace into Settings; it has no children.
```

Keep the `/admin/crm/sync` redirect on the line below.

- [ ] **Step 4: Commit**

```bash
git add -A app/admin/settings next.config.mjs
git commit -m "refactor: remove campaign UI, settings tab, and redirects"
```

---

## Task 5: Delete the campaign API, cron, and Mailgun webhook

**Files:**
- Delete: `app/api/admin/crm/campaigns/` (5 route files), `app/api/cron/crm-campaigns/`, `app/api/webhooks/mailgun/`
- Modify: `vercel.json`

The Mailgun webhook goes with them: `VERCEL_ENV_CHECKLIST.md:164` documents Mailgun as "CRM campaign delivery only," and the route's only writes are to `cornerstone_crm_campaign_events` and `cornerstone_crm_campaign_deliveries`. It handles no transactional mail.

- [ ] **Step 1: Delete the routes**

```bash
git rm -r "app/api/admin/crm/campaigns" "app/api/cron/crm-campaigns" "app/api/webhooks/mailgun"
```

- [ ] **Step 2: Remove the cron entry**

In `vercel.json`, delete this object from the `crons` array:

```json
    {
      "path": "/api/cron/crm-campaigns",
      "schedule": "0 13 * * *"
    },
```

- [ ] **Step 3: Verify no dangling references**

```bash
grep -rn "crm-campaigns\|webhooks/mailgun\|admin/crm/campaigns" --include="*.ts" --include="*.tsx" --include="*.json" app lib components vercel.json
```

Expected: no output. Any hit is a reference you still need to remove.

- [ ] **Step 4: Commit**

```bash
git add -A app/api vercel.json
git commit -m "refactor: remove campaign API routes, dispatch cron, and Mailgun webhook"
```

---

## Task 6: Retire the unsubscribe endpoint

**This task branches on the Task 1 result.** Do the branch that matches; skip the other.

### Branch A — nothing was ever sent

**Files:** Delete `app/api/unsubscribe/[token]/`

- [ ] **A1: Confirm the branch**

Re-read your recorded Task 1 result. Proceed only if `deliveries_attempted = 0`. If it is not zero, do Branch B.

- [ ] **A2: Delete the route**

```bash
git rm -r "app/api/unsubscribe"
```

- [ ] **A3: Commit**

```bash
git add -A app/api
git commit -m "refactor: remove unsubscribe endpoint (no campaign was ever sent)"
```

### Branch B — campaigns were sent

The endpoint must keep working until 30 days after `last_send_at`. Reduce it to a self-contained handler that no longer imports the deleted dispatch module, but still honors an opt-out.

**Files:** Modify `app/api/unsubscribe/[token]/route.ts`

- [ ] **B1: Replace the route body**

Replace the entire contents of `app/api/unsubscribe/[token]/route.ts` with:

```typescript
import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'

/**
 * Retained unsubscribe endpoint for campaigns sent before the campaign system
 * was removed. CAN-SPAM (16 CFR 316.5) requires the mechanism in a sent message
 * to keep working for at least 30 days. This is self-contained on purpose: the
 * dispatch library it used to call is gone.
 *
 * Delete this route, and the deliveries table it reads, only after the date
 * recorded in docs/superpowers/plans/2026-08-27-remove-crm-campaigns.md.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ token: string }> }

const PAGE = '<!doctype html><title>Unsubscribed</title><main style="font-family:system-ui;max-width:36rem;margin:4rem auto"><h1>You have been unsubscribed.</h1><p>You will no longer receive Cornerstone marketing emails at this address.</p></main>'

export async function GET(_req: Request, { params }: Context) {
  const token = (await params).token
  if (!/^[a-f0-9]{64}$/i.test(token)) {
    return new NextResponse('Invalid unsubscribe link', { status: 400 })
  }

  const admin = getAdminClient()
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')

  const { data: delivery } = await admin
    .from('cornerstone_crm_campaign_deliveries')
    .select('id, campaign_recipient_id')
    .eq('delivery_token_hash', tokenHash)
    .maybeSingle()
  if (!delivery) {
    return new NextResponse('This unsubscribe link is no longer valid.', { status: 404 })
  }

  const { data: recipient } = await admin
    .from('cornerstone_crm_campaign_recipients')
    .select('person_id')
    .eq('id', delivery.campaign_recipient_id)
    .maybeSingle()

  const now = new Date().toISOString()
  await admin
    .from('cornerstone_crm_campaign_deliveries')
    .update({ provider_status: 'unsubscribed', last_event_at: now })
    .eq('id', delivery.id)

  if (recipient?.person_id) {
    await admin
      .from('cornerstone_crm_people')
      .update({ marketing_status: 'opted_out', campaign_opt_out: true, unsubscribed_at: now })
      .eq('id', recipient.person_id)
  }

  return new NextResponse(PAGE, { headers: { 'content-type': 'text/html; charset=utf-8' } })
}
```

- [ ] **B2: Write a test for the retained behavior**

Create `tests/unsubscribe-retention.test.ts`:

```typescript
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')

describe('retained unsubscribe endpoint', () => {
  it('still exists and writes the opt-out to the people record', () => {
    const source = read('app/api/unsubscribe/[token]/route.ts')
    expect(source).toContain("from('cornerstone_crm_people')")
    expect(source).toContain("marketing_status: 'opted_out'")
    expect(source).toContain('unsubscribed_at')
  })

  it('does not import the removed campaign dispatch module', () => {
    const source = read('app/api/unsubscribe/[token]/route.ts')
    expect(source).not.toContain('campaignDispatch')
    expect(source).not.toContain('mailgunCampaigns')
  })
})
```

- [ ] **B3: Run the test**

```bash
npx vitest run tests/unsubscribe-retention.test.ts
```

Expected: PASS (2 tests).

- [ ] **B4: Commit**

```bash
git add "app/api/unsubscribe/[token]/route.ts" tests/unsubscribe-retention.test.ts
git commit -m "refactor: make retained unsubscribe endpoint self-contained"
```

---

## Task 7: Delete the dispatch library and strip campaign code from the shared query module

**Files:**
- Delete: `lib/crm/campaignDispatch.ts`, `lib/crm/campaignPolicy.ts`, `lib/crm/mailgunCampaigns.ts`, `tests/crm-campaign-policy.test.ts`
- Modify: `lib/queries/cornerstoneCrm.ts`

`lib/crm/consent.ts` and `lib/crm/dashboard.ts` **stay** — `consent.ts` is imported by `app/admin/matters/[id]/page.tsx`, `MatterFactsPanel.tsx`, `MatterDetailClient.tsx`, and `tabs/messages.tsx`.

- [ ] **Step 1: Delete the three modules and their test**

```bash
git rm lib/crm/campaignDispatch.ts lib/crm/campaignPolicy.ts lib/crm/mailgunCampaigns.ts tests/crm-campaign-policy.test.ts
```

- [ ] **Step 2: Strip campaign symbols from `lib/queries/cornerstoneCrm.ts`**

Delete these declarations by name. They are campaign-only; `filterCrmPeople` has no consumers at all and goes with them.

| Symbol | Approx. line |
|---|---|
| `CAMPAIGN_STATUSES` const | 14 |
| `CAMPAIGN_TYPES` const | 15 |
| `CrmPeopleFilter` type | 77 |
| `CrmCampaignType` type | 82 |
| `CrmCampaignStatus` type | 83 |
| `CrmCampaignAudienceRules` interface | 85 |
| `CrmCampaignRecipientCounts` interface | 93 |
| `CrmCampaignListItem` interface | 106 |
| `CrmCampaignDbRow` interface | 124 |
| `emptyCampaignRecipientCounts()` | 209 |
| `parseCampaignAudienceRules()` | 243 |
| `mapRecipientCounts()` | 254 |
| `getLifecycleLabel()` | 288 |
| `fetchCrmCampaigns()` | 498 |
| `fetchCrmCampaignById()` | 565 |
| `filterCrmPeople()` | 613 |

**Keep:** `CrmStageRow`, `CrmPeopleRow`, `CrmDashboardPersonRow`, `CrmImportSummary`, `fetchCrmStages`, `fetchCrmDashboardPeople`, `fetchCrmPeople`, and the `CrmPersonRow` / `CrmLeadRow` / `CrmMatterRow` / `CrmPersonStageRow` internal types.

`fetchCrmPeople` takes a `CrmPeopleFilter` parameter. If removing that type breaks its signature, inline the shape it actually needs rather than keeping the campaign-facing type:

```typescript
export type CrmPeopleLifecycle = 'all' | 'lead' | 'client' | 'contact'
```

and change the parameter type accordingly. Step 3's typecheck is what tells you whether this was necessary.

- [ ] **Step 3: Typecheck to find anything the deletions broke**

```bash
npm run typecheck
```

Expected: clean. Any error naming a deleted symbol is a call site the inventory missed — fix it by removing the caller if it is campaign UI, or by inlining the type if it is CRM people code. Re-run until clean.

- [ ] **Step 4: Lint**

```bash
npm run lint
```

Expected: clean. Unused-import errors in `lib/queries/cornerstoneCrm.ts` mean an import only the deleted code used; remove it.

- [ ] **Step 5: Run the full suite**

```bash
nvm use 22 && npm test
```

Expected: PASS, with `tests/crm-hub.test.ts` now green — it was failing since Task 3.

Note the `nvm use 22`: the repo declares `engines: >=22 <26`, and on Node 26 the experimental global `localStorage` shadows jsdom's, producing ~44 spurious failures in DOM tests.

- [ ] **Step 6: Commit**

```bash
git add -A lib tests
git commit -m "refactor: delete campaign dispatch library and campaign queries"
```

---

## Task 8: Remove Mailgun configuration and documentation

**Files:**
- Modify: `VERCEL_ENV_CHECKLIST.md:164-168`

- [ ] **Step 1: Delete the Mailgun rows**

Remove these five table rows from `VERCEL_ENV_CHECKLIST.md`:

```markdown
| `MAILGUN_API_KEY` | Mailgun API key for CRM campaign delivery only |
| `MAILGUN_DOMAIN` | Verified Mailgun sending domain for campaigns |
| `MAILGUN_API_BASE` | Optional regional API base; use `https://api.eu.mailgun.net` for EU |
| `MAILGUN_WEBHOOK_SIGNING_KEY` | Mailgun webhook signing key |
| `MAILGUN_FROM_EMAIL` | Verified Mailgun campaign sender |
```

- [ ] **Step 2: Confirm nothing still reads them**

```bash
grep -rn "MAILGUN" --include="*.ts" --include="*.tsx" --include="*.mjs" --include="*.md" app lib components scripts *.md
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add VERCEL_ENV_CHECKLIST.md
git commit -m "docs: drop Mailgun env vars with the campaign system"
```

- [ ] **Step 4: Delete the Vercel environment variables**

In the Vercel dashboard for this project, under Settings → Environment Variables, delete `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_API_BASE`, `MAILGUN_WEBHOOK_SIGNING_KEY`, and `MAILGUN_FROM_EMAIL` from every environment.

- [ ] **Step 5: Disable the Mailgun webhook at the provider**

In the Mailgun dashboard, remove the webhook pointing at `/api/webhooks/mailgun`. Left in place it will retry against a 404 on every delivery event. Do this **after** the deploy in Task 9 lands, not before.

---

## Task 9: Open PR 1 and deploy

- [ ] **Step 1: Verify the whole gate locally**

```bash
nvm use 22 && npm run lint && npm run typecheck && npm test && npm run build:next
```

Expected: all four pass.

- [ ] **Step 2: Confirm no database migration is in this PR**

```bash
git diff --name-only main...HEAD -- supabase/migrations/
```

Expected: no output. If a migration appears here, move it to PR 2 — a drop shipping alongside this code can land before the code does and break production.

- [ ] **Step 3: Open the PR**

```bash
gh pr create --title "Remove the CRM campaign system (code only)" --body "$(cat <<'EOF'
Removes the in-house drip email marketing system: ~2,100 LOC across the campaign
UI, API routes, dispatch library, daily cron, and Mailgun webhook.

**No database changes.** The six `cornerstone_crm_campaign_*` tables and the
`claim_crm_campaign_deliveries` RPC stay in place; they are dropped in a
follow-up PR so the schema change cannot land before this code is gone.

**Consent is preserved.** `cornerstone_crm_people.marketing_status`,
`consent_source`, `consent_captured_at`, `unsubscribed_at`, and
`campaign_opt_out` are untouched, as are `lib/crm/consent.ts`,
`MarketingProfileCard`, and the CRM profiles API. The matter detail page and
messages tab read these to gate nurture email.

**Unsubscribe:** see the recorded Task 1 result in
`docs/superpowers/plans/2026-08-27-remove-crm-campaigns.md`.

Campaign data was exported to the firm retention store before removal.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: After merge, verify production**

Once Vercel finishes deploying `main`:

1. Load `/admin/settings` — the Campaigns tab is gone, Sync remains.
2. Load `/admin/crm` — the CRM dashboard renders with no error banner.
3. Open any matter's detail page — the marketing consent value still displays in the facts panel.
4. Branch B only: request a known unsubscribe URL and confirm it still returns the confirmation page.

---

## Task 10 (PR 2 — separate, later): Drop the campaign tables

**Do not start this until:**
- PR 1 is merged and deployed, **and**
- Branch B only: today is at least 30 days after the `last_send_at` recorded in Task 1.

**Files:**
- Create: `supabase/migrations/<timestamp>_drop_crm_campaign_tables.sql`
- Modify: `types/supabase.generated.ts` (regenerated, not hand-edited)
- Branch B only: Delete `app/api/unsubscribe/[token]/`, `tests/unsubscribe-retention.test.ts`

- [ ] **Step 1: Branch B only — remove the retained unsubscribe route first**

```bash
git rm -r "app/api/unsubscribe" tests/unsubscribe-retention.test.ts
```

Its table is about to disappear. On Branch A this route was already deleted in Task 6.

- [ ] **Step 2: Create the migration**

```bash
./node_modules/.bin/supabase migration new drop_crm_campaign_tables
```

- [ ] **Step 3: Write the migration**

Put this in the generated file:

```sql
-- Drops the CRM campaign system. The application code that read these objects
-- was removed in the preceding release, so nothing references them.
--
-- Consent is NOT dropped: cornerstone_crm_people.marketing_status,
-- consent_source, consent_captured_at, unsubscribed_at and campaign_opt_out are
-- the firm's durable record of who opted out and are read by the matter detail
-- page and messages tab. Only the campaign machinery goes.
--
-- Row data was exported to the firm retention store before this ran.

drop function if exists public.claim_crm_campaign_deliveries(uuid, integer);
drop function if exists public.enforce_crm_recipient_snapshot_immutable() cascade;

-- Order matters only for readability; cascade handles the FK graph, the
-- emit_crm_outbox_event trigger on campaign_recipients, and the RLS policies.
drop table if exists public.cornerstone_crm_campaign_events     cascade;
drop table if exists public.cornerstone_crm_campaign_dispatches cascade;
drop table if exists public.cornerstone_crm_campaign_deliveries cascade;
drop table if exists public.cornerstone_crm_campaign_recipients cascade;
drop table if exists public.cornerstone_crm_campaign_steps      cascade;
drop table if exists public.cornerstone_crm_campaigns           cascade;
```

- [ ] **Step 4: Apply and verify locally**

```bash
sg docker -c "SUPABASE_AUTH_SITE_URL=http://localhost:3002 ./node_modules/.bin/supabase db reset"
```

Expected: the full migration chain applies with no error.

- [ ] **Step 5: Verify the consent columns survived**

```bash
./node_modules/.bin/supabase db reset --local >/dev/null 2>&1
psql "$(./node_modules/.bin/supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" -c "
select column_name from information_schema.columns
where table_name = 'cornerstone_crm_people'
  and column_name in ('marketing_status','consent_source','consent_captured_at','unsubscribed_at','campaign_opt_out')
order by column_name;"
```

Expected: five rows — `campaign_opt_out`, `consent_captured_at`, `consent_source`, `marketing_status`, `unsubscribed_at`. Fewer means the cascade took something it should not have; stop and fix the migration.

- [ ] **Step 6: Confirm no campaign tables remain**

```bash
psql "$(./node_modules/.bin/supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" -c "
select table_name from information_schema.tables
where table_schema = 'public' and table_name like 'cornerstone_crm_campaign%';"
```

Expected: 0 rows.

- [ ] **Step 7: Run the suite**

```bash
nvm use 22 && npm test
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A supabase/migrations app tests
git commit -m "feat: drop CRM campaign tables and dispatch RPC"
```

- [ ] **Step 9: Open PR 2**

```bash
gh pr create --title "Drop CRM campaign tables" --body "$(cat <<'EOF'
Follow-up to the campaign code removal. Drops the six
`cornerstone_crm_campaign_*` tables, the `claim_crm_campaign_deliveries` RPC,
and the recipient-snapshot trigger.

Safe to apply because the application code that read them shipped out in the
previous release.

Consent columns on `cornerstone_crm_people` are deliberately retained.

Row data was exported to the firm retention store before removal.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 10: After merge, regenerate the checked-in database types**

`db-migrate-deploy.yml` applies the migration on merge. `db-types-drift.yml` will then flag `types/supabase.generated.ts` as stale on its next scheduled run. Get ahead of it:

```bash
npm run db:types:linked
git add types/supabase.generated.ts
git commit -m "chore: regenerate database types after campaign table drop"
```

- [ ] **Step 11: Verify the RPC check passes**

```bash
npm run check:db-rpcs
```

Expected: clean. `scripts/checkDbRpcs.mjs` scans source for `.rpc('...')` calls, and the only caller of `claim_crm_campaign_deliveries` was deleted in PR 1 — so the dropped function is no longer looked for.

- [ ] **Step 12: Confirm the consent record is intact in production**

Re-run the Task 1 query against the shared database. `opted_out_people` must equal the value you recorded in Task 1. The campaign counts will now error with "relation does not exist," which is the expected outcome — run only the final `opted_out_people` clause.

---

## Self-Review

**Spec coverage.** Every file in the inventory has a task: UI (Task 4), API/cron/webhook (Task 5), unsubscribe (Task 6), library + shared queries (Task 7), env/docs (Task 8), database (Task 10). Tests are inverted before deletion (Task 3) and re-run after (Task 7 Step 5).

**Preserved-surface coverage.** `lib/crm/consent.ts`, `lib/crm/dashboard.ts`, `MarketingProfileCard`, the CRM profiles route, and the five consent columns are named as retained in the File Structure table, asserted by a new test in Task 3 Step 1, and verified in the database in Task 10 Step 5.

**Known soft spots, flagged rather than hidden.** Task 7 Step 2 lists symbols by name and approximate line, since line numbers shift as you delete upward; the typecheck in Step 3 is the real verification. `fetchCrmPeople`'s dependence on `CrmPeopleFilter` may or may not need the inlined `CrmPeopleLifecycle` type — the plan says to let the typecheck decide rather than asserting an outcome I did not verify.

**Ordering.** Code before schema, across two PRs, because `db-migrate-deploy.yml` and Vercel deploy independently on the same push. Task 9 Step 2 enforces this with an explicit check.
