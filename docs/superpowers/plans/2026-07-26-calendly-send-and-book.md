# Calendly Link Sending + In-App Booking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff can send a client the right Calendly booking link (email / SMS / portal message) and book a Calendly appointment on a client's behalf via an embedded booking page, from both lead and matter detail pages.

**Architecture:** Calendly URLs are stored per meeting type in the `scheduling_settings` singleton and edited in admin settings. A server-side link builder appends Calendly prefill params + `utm_content=leadId:…/matterId:…`, which the already-shipped webhook (`lib/calendly/normalize.ts` `trackingId`) parses to auto-link bookings — no new sync code. One admin endpoint (`GET`/`POST /api/admin/scheduling-links/send`) serves dialog data and fans out sends to the existing email/SMS/portal-message infrastructure. Two shared dialogs provide the UI.

**Tech Stack:** Next.js App Router (route handlers), Supabase (postgres + admin client), vitest, existing `lib/email/send`, `lib/sms/outbound`, `lib/portalNotifications`, shadcn ui primitives.

**Spec:** `docs/superpowers/specs/2026-07-26-calendly-send-and-book-design.md`

**Branch:** `claude/calendly-send-and-book` (already checked out; based on the Calendly webhook work).

**Run tests with:** `npx vitest run <file>` from the repo root.

---

## File structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20260816000000_calendly_links_and_lead_sms.sql` (create) | `scheduling_settings.calendly_urls` jsonb; `sms_messages.lead_id` |
| `lib/calendly/links.ts` (create) | `sanitizeCalendlyUrls`, `buildCalendlyLink`, `getCalendlyUrls` |
| `lib/email/categories.ts` (modify) | add `scheduling_link` category |
| `lib/sms/outbound.ts` (modify) | lead-target SMS: `resolveLeadSmsTarget`, lead-aware row + activity |
| `app/api/admin/scheduling-links/send/route.ts` (create) | GET dialog data; POST send fan-out |
| `lib/linkify.tsx` (create) | render text with clickable https links |
| `app/(portal)/messages/MessageThread.tsx` (modify) | linkify message bodies |
| `app/admin/matters/[id]/tabs/messages.tsx` (modify) | linkify portal-message bodies; matter entry-point buttons |
| `lib/appointments/types.ts`, `lib/appointments/settings.ts`, `app/api/admin/scheduling/settings/route.ts` (modify) | `calendlyUrls` in settings read/write |
| `app/admin/settings/CalendlyLinksSection.tsx` (create) + `StaffSettingsClient.tsx` (modify) | settings UI card |
| `components/scheduling/SendSchedulingLinkDialog.tsx` (create) | send dialog (shared) |
| `components/scheduling/BookCalendlyDialog.tsx` (create) | embedded booking dialog (shared) |
| `components/leads/LeadTopActions.tsx`, `app/admin/leads/[id]/LeadDetailClient.tsx` (modify) | lead entry points |
| `tests/calendly-links.test.ts`, `tests/lead-sms-outbound.test.ts`, `tests/scheduling-link-send.test.ts`, `tests/linkify.test.tsx` (create) | coverage |

---

### Task 1: DB migration

**Files:**
- Create: `supabase/migrations/20260816000000_calendly_links_and_lead_sms.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Calendly booking links config + lead-scoped outbound SMS.

-- Map of meeting type key -> Calendly booking page URL, edited in
-- Settings -> Scheduling. Empty object = nothing configured.
ALTER TABLE public.scheduling_settings
  ADD COLUMN IF NOT EXISTS calendly_urls jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.scheduling_settings.calendly_urls IS
  'Per meeting-type Calendly booking URLs ({"discovery_call": "https://calendly.com/...", ...}).';

-- Scheduling-link texts can target a lead before any matter exists.
-- matter_id is already nullable; a row belongs to a matter, a lead, or
-- (legacy/unmatched inbound) neither.
ALTER TABLE public.sms_messages
  ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES public.client_intake(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS sms_messages_lead_id_created_at_idx
  ON public.sms_messages (lead_id, created_at DESC)
  WHERE lead_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260816000000_calendly_links_and_lead_sms.sql
git commit -m "feat: add calendly_urls setting and lead-scoped sms_messages column"
```

---

### Task 2: Link builder — `lib/calendly/links.ts`

**Files:**
- Create: `lib/calendly/links.ts`
- Test: `tests/calendly-links.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: vi.fn() }))

import { buildCalendlyLink, sanitizeCalendlyUrls } from '@/lib/calendly/links'

describe('sanitizeCalendlyUrls', () => {
  it('keeps valid meeting-type keys with calendly.com https URLs', () => {
    expect(sanitizeCalendlyUrls({
      discovery_call: 'https://calendly.com/aubreylaw/discovery',
      pmps: 'https://calendly.com/aubreylaw/pmps',
    })).toEqual({
      discovery_call: 'https://calendly.com/aubreylaw/discovery',
      pmps: 'https://calendly.com/aubreylaw/pmps',
    })
  })

  it('drops unknown keys, non-calendly origins, and non-string values', () => {
    expect(sanitizeCalendlyUrls({
      not_a_type: 'https://calendly.com/x',
      discovery_call: 'https://evil.example.com/x',
      pmps: 42,
      signing_appointment: 'http://calendly.com/insecure',
    })).toEqual({})
  })

  it('returns {} for non-object input', () => {
    expect(sanitizeCalendlyUrls(null)).toEqual({})
    expect(sanitizeCalendlyUrls('nope')).toEqual({})
  })
})

describe('buildCalendlyLink', () => {
  const base = 'https://calendly.com/aubreylaw/discovery'

  it('adds prefill and utm params', () => {
    const url = new URL(buildCalendlyLink(base, {
      name: 'Avery Stone',
      email: 'avery@example.com',
      leadId: '123e4567-e89b-12d3-a456-426614174000',
      channel: 'email',
    }))
    expect(url.searchParams.get('name')).toBe('Avery Stone')
    expect(url.searchParams.get('email')).toBe('avery@example.com')
    expect(url.searchParams.get('utm_source')).toBe('app')
    expect(url.searchParams.get('utm_medium')).toBe('email')
    expect(url.searchParams.get('utm_content')).toBe('leadId:123e4567-e89b-12d3-a456-426614174000')
  })

  it('prefers matterId over leadId and omits absent prefill', () => {
    const url = new URL(buildCalendlyLink(base, {
      leadId: '123e4567-e89b-12d3-a456-426614174000',
      matterId: '223e4567-e89b-12d3-a456-426614174000',
      channel: 'staff',
    }))
    expect(url.searchParams.get('utm_content')).toBe('matterId:223e4567-e89b-12d3-a456-426614174000')
    expect(url.searchParams.has('name')).toBe(false)
    expect(url.searchParams.has('email')).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/calendly-links.test.ts`
Expected: FAIL — module `@/lib/calendly/links` not found.

- [ ] **Step 3: Implement**

```ts
import { getAdminClient } from '@/lib/supabaseAdmin'
import { meetingTypeForKey, type MeetingTypeKey } from '@/lib/scheduling'

export type CalendlyLinkChannel = 'email' | 'sms' | 'portal' | 'staff'

export type CalendlyUrlMap = Partial<Record<MeetingTypeKey, string>>

function isCalendlyUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    return new URL(value).origin === 'https://calendly.com'
  } catch {
    return false
  }
}

export function sanitizeCalendlyUrls(value: unknown): CalendlyUrlMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const map: CalendlyUrlMap = {}
  for (const [key, url] of Object.entries(value as Record<string, unknown>)) {
    const meetingType = meetingTypeForKey(key)
    if (meetingType && isCalendlyUrl(url)) map[meetingType.key] = url
  }
  return map
}

export function buildCalendlyLink(
  baseUrl: string,
  opts: {
    name?: string | null
    email?: string | null
    leadId?: string | null
    matterId?: string | null
    channel: CalendlyLinkChannel
  },
): string {
  const url = new URL(baseUrl)
  if (opts.name) url.searchParams.set('name', opts.name)
  if (opts.email) url.searchParams.set('email', opts.email)
  url.searchParams.set('utm_source', 'app')
  url.searchParams.set('utm_medium', opts.channel)
  // matterId wins: matches the webhook's matter-first resolution
  // (lib/bookings/sync.ts) so the booking links to the matter.
  if (opts.matterId) url.searchParams.set('utm_content', `matterId:${opts.matterId}`)
  else if (opts.leadId) url.searchParams.set('utm_content', `leadId:${opts.leadId}`)
  return url.toString()
}

export async function getCalendlyUrls(): Promise<CalendlyUrlMap> {
  const { data } = await getAdminClient()
    .from('scheduling_settings')
    .select('calendly_urls')
    .eq('id', 1)
    .maybeSingle()
  return sanitizeCalendlyUrls((data as { calendly_urls?: unknown } | null)?.calendly_urls)
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/calendly-links.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/calendly/links.ts tests/calendly-links.test.ts
git commit -m "feat: calendly link builder with prefill and utm tracking"
```

---

### Task 3: `scheduling_link` email category

**Files:**
- Modify: `lib/email/categories.ts`

- [ ] **Step 1: Add the category**

In `EMAIL_CATEGORIES` (line 1-14), add `'scheduling_link',` after `'appointment_missed_followup',`. In `EMAIL_CATEGORY_META` (line 33+), add before `manual`:

```ts
  scheduling_link: {
    category: 'scheduling_link',
    label: 'Scheduling link',
    description: 'Sent to a client or lead with a Calendly link to book an appointment.',
    recipient: 'client',
  },
```

(The `Record<EmailCategory, EmailCategoryMeta>` type makes the meta entry compile-enforced.)

- [ ] **Step 2: Typecheck + existing email tests**

Run: `npx tsc --noEmit && npx vitest run tests --silent 2>&1 | tail -5`
Expected: typecheck clean; suite still green.

- [ ] **Step 3: Commit**

```bash
git add lib/email/categories.ts
git commit -m "feat: add scheduling_link email category"
```

---

### Task 4: Lead-target SMS — `lib/sms/outbound.ts`

**Files:**
- Modify: `lib/sms/outbound.ts`
- Test: `tests/lead-sms-outbound.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const inserts: Array<{ table: string; values: Record<string, unknown> }> = []

vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({
    from: (table: string) => ({
      insert: (values: Record<string, unknown>) => {
        inserts.push({ table, values })
        return {
          select: () => ({
            single: async () => ({ data: { id: `${table}-1`, ...values }, error: null }),
          }),
        }
      },
      update: () => ({
        eq: () => ({
          select: () => ({
            single: async () => ({ data: { id: 'sms_messages-1' }, error: null }),
          }),
        }),
      }),
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              id: 'lead-1',
              first_name: 'Avery',
              last_name: 'Stone',
              full_name: 'Avery Stone',
              phone: '+15555550123',
            },
            error: null,
          }),
        }),
      }),
    }),
  }),
}))

vi.mock('@/lib/sms/provider', () => ({
  normalizeSmsRecipient: (phone: string | null) => phone,
  sendProviderSmsMessage: vi.fn(async () => ({
    ok: true,
    status: 'queued',
    providerMessageId: 'SM123',
  })),
}))

vi.mock('@/lib/communications/providers', () => ({ smsProvider: () => 'twilio' }))
vi.mock('@/lib/telnyx/config', () => ({ telnyxPhoneNumber: () => null }))

import { resolveLeadSmsTarget, sendOutboundSms } from '@/lib/sms/outbound'

beforeEach(() => {
  inserts.length = 0
})

describe('lead-target outbound SMS', () => {
  it('resolves a lead target from client_intake', async () => {
    const { target, error } = await resolveLeadSmsTarget('lead-1')
    expect(error).toBeNull()
    expect(target).toMatchObject({
      leadId: 'lead-1',
      matterId: null,
      recipientRole: 'client',
      phone: '+15555550123',
    })
    expect(target?.recipientName).toBe('Avery Stone')
  })

  it('writes sms_messages with lead_id and logs lead_activity, not matter_activity', async () => {
    const { target } = await resolveLeadSmsTarget('lead-1')
    const result = await sendOutboundSms(target!, 'Book here: https://calendly.com/x', {
      id: 'user-1',
      email: 'staff@example.com',
      name: 'Staff',
    })

    expect(result.ok).toBe(true)
    const smsInsert = inserts.find(i => i.table === 'sms_messages')
    expect(smsInsert?.values).toMatchObject({ lead_id: 'lead-1', matter_id: null })
    expect(inserts.some(i => i.table === 'lead_activity')).toBe(true)
    expect(inserts.some(i => i.table === 'matter_activity')).toBe(false)
    const activity = inserts.find(i => i.table === 'lead_activity')
    expect(activity?.values).toMatchObject({ lead_id: 'lead-1', event_type: 'sms' })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/lead-sms-outbound.test.ts`
Expected: FAIL — `resolveLeadSmsTarget` is not exported.

- [ ] **Step 3: Implement in `lib/sms/outbound.ts`**

Change `ResolvedSmsTarget` (line 17-22):

```ts
export interface ResolvedSmsTarget {
  recipientName: string
  recipientRole: SmsRecipientRole
  phone: string | null
  /** Exactly one of matterId / leadId is set. */
  matterId: string | null
  leadId?: string | null
}
```

Existing `resolveMatterSmsTarget` returns already satisfy this (matterId set, leadId absent). Add after it:

```ts
export async function resolveLeadSmsTarget(
  leadId: string,
): Promise<{ target: ResolvedSmsTarget | null; error: string | null }> {
  const admin = getAdminClient()
  const { data: lead, error } = await admin
    .from('client_intake')
    .select('id, first_name, last_name, full_name, phone')
    .eq('id', leadId)
    .maybeSingle()

  if (error) return { target: null, error: error.message }
  if (!lead) return { target: null, error: 'Lead not found' }

  const name =
    lead.full_name?.trim() ||
    [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() ||
    'Lead'

  return {
    target: {
      recipientName: name,
      recipientRole: 'client',
      phone: lead.phone,
      matterId: null,
      leadId,
    },
    error: null,
  }
}
```

In `sendOutboundSms`, change `baseRow` (line 113) to carry both FKs:

```ts
  const baseRow = {
    matter_id: target.matterId,
    lead_id: target.leadId ?? null,
    ...
```

Replace the activity block (lines 176-209): when `target.matterId` is set keep the existing `matter_activity` insert unchanged; otherwise, when `target.leadId` is set, insert lead activity instead:

```ts
  let activity: Record<string, unknown> | null = null
  const title = result.ok
    ? `Text sent to ${target.recipientName}`
    : `Text failed to ${target.recipientName}`
  const detail = `To ${to}${result.ok ? '' : ` (${result.error})`}`

  if (target.matterId) {
    // ...existing matter_activity insert, unchanged...
  } else if (target.leadId) {
    const { data: leadActivity, error: activityError } = await admin
      .from('lead_activity')
      .insert({
        lead_id: target.leadId,
        event_type: 'sms',
        title,
        detail,
        actor_id: actor.id,
      })
      .select()
      .single()
    if (activityError) {
      console.error('sendOutboundSms: failed to log lead activity', activityError)
    } else {
      activity = leadActivity as Record<string, unknown>
    }
  }
```

- [ ] **Step 4: Run new + neighboring tests**

Run: `npx vitest run tests/lead-sms-outbound.test.ts tests/appointment-booking.test.ts && npx vitest run tests --silent 2>&1 | tail -5`
Expected: PASS; full suite green (the matter SMS path is unchanged).

- [ ] **Step 5: Commit**

```bash
git add lib/sms/outbound.ts tests/lead-sms-outbound.test.ts
git commit -m "feat: lead-targeted outbound SMS"
```

---

### Task 5: Send endpoint — `app/api/admin/scheduling-links/send/route.ts`

**Files:**
- Create: `app/api/admin/scheduling-links/send/route.ts`
- Test: `tests/scheduling-link-send.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const inserts: Array<{ table: string; values: Record<string, unknown> }> = []
const sendEmail = vi.fn(async () => ({ ok: true, status: 'sent', logId: 'log-1' }))
const sendOutboundSms = vi.fn(async () => ({ ok: true, status: 'queued', providerMessageId: 'SM1', smsMessage: {}, activity: null }))
const notifyClientOfFirmMessage = vi.fn(async () => undefined)

vi.mock('@/lib/apiAuth', () => ({
  requireAdmin: vi.fn(async () => ({
    err: null,
    userId: 'user-1',
    user: { email: 'staff@example.com', user_metadata: { full_name: 'Staff' } },
  })),
}))

vi.mock('@/lib/email/send', () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }))

vi.mock('@/lib/sms/outbound', () => ({
  resolveLeadSmsTarget: vi.fn(async (leadId: string) => ({
    target: { recipientName: 'Avery Stone', recipientRole: 'client', phone: '+15555550123', matterId: null, leadId },
    error: null,
  })),
  resolveMatterSmsTarget: vi.fn(async (matterId: string) => ({
    target: { recipientName: 'Avery Stone', recipientRole: 'client', phone: '+15555550123', matterId, leadId: null },
    error: null,
  })),
  sendOutboundSms: (...a: unknown[]) => sendOutboundSms(...a),
}))

vi.mock('@/lib/communications/config', () => ({ isSmsConfigured: () => true }))
vi.mock('@/lib/portalNotifications', () => ({
  notifyClientOfFirmMessage: (...a: unknown[]) => notifyClientOfFirmMessage(...a),
}))

vi.mock('@/lib/calendly/links', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/calendly/links')>()),
  getCalendlyUrls: vi.fn(async () => ({
    discovery_call: 'https://calendly.com/aubreylaw/discovery',
    signing_appointment: 'https://calendly.com/aubreylaw/signing',
  })),
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (table === 'client_intake') {
              return { data: { id: 'lead-1', first_name: 'Avery', last_name: 'Stone', full_name: 'Avery Stone', email: 'avery@example.com', phone: '+15555550123' }, error: null }
            }
            if (table === 'v_matter_pipeline') {
              return { data: { matter_id: 'matter-1', client_name: 'Avery Stone', client_email: 'avery@example.com', client_phone: '+15555550123' }, error: null }
            }
            return { data: null, error: null }
          },
        }),
      }),
      insert: (values: Record<string, unknown>) => {
        inserts.push({ table, values })
        return { select: () => ({ single: async () => ({ data: { id: `${table}-1`, ...values }, error: null }) }) }
      },
    }),
  }),
}))

async function post(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/admin/scheduling-links/send/route')
  const res = await POST(new Request('http://localhost/api/admin/scheduling-links/send', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as never)
  return { res, json: await res.json() }
}

beforeEach(() => {
  inserts.length = 0
  sendEmail.mockClear()
  sendOutboundSms.mockClear()
  notifyClientOfFirmMessage.mockClear()
  vi.resetModules()
})

describe('GET /api/admin/scheduling-links/send', () => {
  it('returns configured types with per-channel links and embed url', async () => {
    const { GET } = await import('@/app/api/admin/scheduling-links/send/route')
    const res = await GET(new Request('http://localhost/api/admin/scheduling-links/send?leadId=lead-1') as never)
    const json = await res.json()

    expect(json.smsConfigured).toBe(true)
    expect(json.recipient).toMatchObject({ name: 'Avery Stone', email: 'avery@example.com' })
    const discovery = json.types.find((t: { key: string }) => t.key === 'discovery_call')
    expect(discovery.configured).toBe(true)
    expect(discovery.links.email).toContain('utm_medium=email')
    expect(discovery.links.email).toContain('utm_content=leadId%3Alead-1')
    expect(discovery.embedUrl).toContain('utm_medium=staff')
    const pmps = json.types.find((t: { key: string }) => t.key === 'pmps')
    expect(pmps.configured).toBe(false)
  })
})

describe('POST /api/admin/scheduling-links/send', () => {
  it('sends an email link to a lead and logs lead_activity', async () => {
    const { res } = await post({
      target: { leadId: 'lead-1' },
      meetingTypeKey: 'discovery_call',
      channel: 'email',
    })

    expect(res.status).toBe(200)
    const [args] = sendEmail.mock.calls[0] as [Record<string, unknown>]
    expect(args.category).toBe('scheduling_link')
    expect(args.to).toBe('avery@example.com')
    expect(String(args.text)).toContain('https://calendly.com/aubreylaw/discovery')
    const activity = inserts.find(i => i.table === 'lead_activity')
    expect(activity?.values).toMatchObject({ lead_id: 'lead-1', event_type: 'email_sent' })
  })

  it('appends the link when the edited message dropped it', async () => {
    await post({
      target: { leadId: 'lead-1' },
      meetingTypeKey: 'discovery_call',
      channel: 'email',
      message: 'Custom note with no link',
    })
    const [args] = sendEmail.mock.calls[0] as [Record<string, unknown>]
    expect(String(args.text)).toContain('Custom note with no link')
    expect(String(args.text)).toContain('https://calendly.com/aubreylaw/discovery')
  })

  it('sends SMS through sendOutboundSms for a matter target', async () => {
    const { res } = await post({
      target: { matterId: 'matter-1' },
      meetingTypeKey: 'signing_appointment',
      channel: 'sms',
    })
    expect(res.status).toBe(200)
    const [, body] = sendOutboundSms.mock.calls[0] as [unknown, string]
    expect(body).toContain('https://calendly.com/aubreylaw/signing')
    expect(body).toContain('utm_medium=sms')
  })

  it('posts a portal message and notifies the client (matter only)', async () => {
    const { res } = await post({
      target: { matterId: 'matter-1' },
      meetingTypeKey: 'signing_appointment',
      channel: 'portal',
    })
    expect(res.status).toBe(200)
    const message = inserts.find(i => i.table === 'messages')
    expect(message?.values).toMatchObject({ matter_id: 'matter-1', sender_role: 'attorney' })
    expect(String(message?.values.body)).toContain('https://calendly.com/aubreylaw/signing')
    expect(notifyClientOfFirmMessage).toHaveBeenCalledWith('matter-1')
  })

  it('rejects portal channel for a lead target', async () => {
    const { res } = await post({
      target: { leadId: 'lead-1' },
      meetingTypeKey: 'discovery_call',
      channel: 'portal',
    })
    expect(res.status).toBe(400)
  })

  it('rejects an unconfigured meeting type', async () => {
    const { res } = await post({
      target: { leadId: 'lead-1' },
      meetingTypeKey: 'pmps',
      channel: 'email',
    })
    expect(res.status).toBe(400)
  })

  it('rejects when neither or both target ids are given', async () => {
    expect((await post({ target: {}, meetingTypeKey: 'discovery_call', channel: 'email' })).res.status).toBe(400)
    expect((await post({ target: { leadId: 'a', matterId: 'b' }, meetingTypeKey: 'discovery_call', channel: 'email' })).res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/scheduling-link-send.test.ts`
Expected: FAIL — route module not found.

- [ ] **Step 3: Implement the route**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { sendEmail } from '@/lib/email/send'
import { isSmsConfigured } from '@/lib/communications/config'
import {
  resolveLeadSmsTarget,
  resolveMatterSmsTarget,
  sendOutboundSms,
} from '@/lib/sms/outbound'
import { notifyClientOfFirmMessage } from '@/lib/portalNotifications'
import { buildCalendlyLink, getCalendlyUrls } from '@/lib/calendly/links'
import { MEETING_TYPE_KEYS, meetingTypeForKey, type MeetingTypeKey } from '@/lib/scheduling'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Recipient {
  name: string
  firstName: string | null
  email: string | null
  phone: string | null
}

async function resolveRecipient(
  target: { leadId?: string | null; matterId?: string | null },
): Promise<{ recipient: Recipient | null; error: string | null }> {
  const admin = getAdminClient()
  if (target.leadId) {
    const { data, error } = await admin
      .from('client_intake')
      .select('id, first_name, last_name, full_name, email, phone')
      .eq('id', target.leadId)
      .maybeSingle()
    if (error) return { recipient: null, error: error.message }
    if (!data) return { recipient: null, error: 'Lead not found' }
    const name =
      data.full_name?.trim() ||
      [data.first_name, data.last_name].filter(Boolean).join(' ').trim() ||
      'Lead'
    return {
      recipient: {
        name,
        firstName: data.first_name?.trim() || null,
        email: data.email?.trim()?.toLowerCase() || null,
        phone: data.phone || null,
      },
      error: null,
    }
  }
  const { data, error } = await admin
    .from('v_matter_pipeline')
    .select('matter_id, client_name, client_email, client_phone')
    .eq('matter_id', target.matterId)
    .maybeSingle()
  if (error) return { recipient: null, error: error.message }
  if (!data) return { recipient: null, error: 'Matter not found' }
  const name = data.client_name?.trim() || 'Client'
  return {
    recipient: {
      name,
      firstName: name.split(' ')[0] || null,
      email: data.client_email?.trim()?.toLowerCase() || null,
      phone: data.client_phone || null,
    },
    error: null,
  }
}

function defaultMessage(firstName: string | null, label: string, link: string): string {
  const greeting = firstName ? `Hi ${firstName},` : 'Hello,'
  return `${greeting}\n\nPlease use this link to schedule your ${label}:\n${link}\n\nIf none of the times work, let us know and we'll find one that does.`
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function textToHtml(text: string, link: string): string {
  const escapedLink = escapeHtml(link)
  const escaped = escapeHtml(text)
  const linked = escaped.includes(escapedLink)
    ? escaped.replace(escapedLink, `<a href="${escapedLink}">${escapedLink}</a>`)
    : escaped
  return `<pre style="font-family:inherit;white-space:pre-wrap">${linked}</pre>`
}

// GET ?leadId=… | ?matterId=… → dialog data: recipient, channel availability,
// per-type per-channel links (utm_medium varies), and staff embed URL.
export async function GET(req: NextRequest) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const leadId = req.nextUrl.searchParams.get('leadId')
  const matterId = req.nextUrl.searchParams.get('matterId')
  if ((leadId && matterId) || (!leadId && !matterId)) {
    return NextResponse.json({ error: 'Pass exactly one of leadId or matterId' }, { status: 400 })
  }

  const { recipient, error } = await resolveRecipient({ leadId, matterId })
  if (error || !recipient) {
    return NextResponse.json({ error: error ?? 'Not found' }, { status: 404 })
  }

  const urls = await getCalendlyUrls()
  const linkOpts = {
    name: recipient.name,
    email: recipient.email,
    leadId,
    matterId,
  }
  const types = MEETING_TYPE_KEYS.map(key => {
    const meetingType = meetingTypeForKey(key)!
    const base = urls[key]
    return {
      key,
      label: meetingType.label,
      configured: Boolean(base),
      links: base
        ? {
            email: buildCalendlyLink(base, { ...linkOpts, channel: 'email' }),
            sms: buildCalendlyLink(base, { ...linkOpts, channel: 'sms' }),
            portal: buildCalendlyLink(base, { ...linkOpts, channel: 'portal' }),
          }
        : null,
      embedUrl: base ? buildCalendlyLink(base, { ...linkOpts, channel: 'staff' }) : null,
    }
  })

  return NextResponse.json({
    recipient: { name: recipient.name, email: recipient.email, phone: recipient.phone },
    smsConfigured: isSmsConfigured(),
    portalAvailable: Boolean(matterId),
    types,
  })
}

export async function POST(req: NextRequest) {
  const { err, userId, user } = await requireAdmin(req)
  if (err) return err

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const target = (body.target ?? {}) as { leadId?: unknown; matterId?: unknown }
  const leadId = typeof target.leadId === 'string' && target.leadId.trim() ? target.leadId.trim() : null
  const matterId = typeof target.matterId === 'string' && target.matterId.trim() ? target.matterId.trim() : null
  if ((leadId && matterId) || (!leadId && !matterId)) {
    return NextResponse.json({ error: 'Pass exactly one of target.leadId or target.matterId' }, { status: 400 })
  }

  const channel = body.channel
  if (channel !== 'email' && channel !== 'sms' && channel !== 'portal') {
    return NextResponse.json({ error: 'channel must be email, sms, or portal' }, { status: 400 })
  }
  if (channel === 'portal' && !matterId) {
    return NextResponse.json({ error: 'Portal messages require a matter target' }, { status: 400 })
  }

  const meetingType = meetingTypeForKey(typeof body.meetingTypeKey === 'string' ? body.meetingTypeKey : null)
  if (!meetingType) {
    return NextResponse.json({ error: 'Unknown meeting type' }, { status: 400 })
  }

  const urls = await getCalendlyUrls()
  const baseUrl = urls[meetingType.key as MeetingTypeKey]
  if (!baseUrl) {
    return NextResponse.json(
      { error: `No Calendly link configured for ${meetingType.label}. Add it in Settings → Scheduling.` },
      { status: 400 },
    )
  }

  const { recipient, error: recipientError } = await resolveRecipient({ leadId, matterId })
  if (recipientError || !recipient) {
    return NextResponse.json({ error: recipientError ?? 'Not found' }, { status: 404 })
  }

  const link = buildCalendlyLink(baseUrl, {
    name: recipient.name,
    email: recipient.email,
    leadId,
    matterId,
    channel,
  })

  const provided = typeof body.message === 'string' ? body.message.trim() : ''
  // Any link to the same booking page counts — the user may have kept a
  // variant with different utm params from the dialog preview.
  const hasLink = provided.includes(baseUrl)
  const message = provided
    ? hasLink ? provided : `${provided}\n\n${link}`
    : defaultMessage(recipient.firstName, meetingType.label, link)

  const admin = getAdminClient()
  const actorName = (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? null

  if (channel === 'email') {
    if (!recipient.email) {
      return NextResponse.json({ error: `${recipient.name} has no email address on file.` }, { status: 400 })
    }
    const subject =
      typeof body.subject === 'string' && body.subject.trim()
        ? body.subject.trim()
        : `Schedule your ${meetingType.label}`
    const result = await sendEmail({
      category: 'scheduling_link',
      to: recipient.email,
      subject,
      text: message,
      html: textToHtml(message, link),
      useStoredTemplate: false,
      userId,
    })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 })
    }
    if (leadId) {
      await admin.from('lead_activity').insert({
        lead_id: leadId,
        event_type: 'email_sent',
        title: `Scheduling link sent: ${meetingType.label}`,
        detail: `To ${recipient.email} · ${result.status}`,
        actor_id: userId,
      })
    } else {
      await admin.from('matter_activity').insert({
        matter_id: matterId,
        event_type: 'email_sent',
        actor_id: userId,
        actor_email: user?.email ?? null,
        actor_name: actorName,
        title: `Scheduling link sent: ${meetingType.label}`,
        detail: `To ${recipient.email} · ${result.status}`,
        metadata: { to: recipient.email, subject, status: result.status, logId: result.logId },
      })
    }
    return NextResponse.json({ success: true, channel, status: result.status })
  }

  if (channel === 'sms') {
    if (!isSmsConfigured()) {
      return NextResponse.json({ error: 'SMS is not configured' }, { status: 503 })
    }
    const { target: smsTarget, error: targetError } = leadId
      ? await resolveLeadSmsTarget(leadId)
      : await resolveMatterSmsTarget(matterId!, 'client')
    if (targetError || !smsTarget) {
      return NextResponse.json({ error: targetError ?? 'Recipient not found' }, { status: 404 })
    }
    const result = await sendOutboundSms(smsTarget, message, {
      id: userId!,
      email: user?.email ?? null,
      name: actorName,
    })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status ?? 502 })
    }
    return NextResponse.json({ success: true, channel, status: result.status })
  }

  // channel === 'portal' (matterId guaranteed above)
  const { error: messageError } = await admin
    .from('messages')
    .insert({
      matter_id: matterId,
      sender_role: 'attorney',
      sender_id: userId,
      body: message,
    })
    .select()
    .single()
  if (messageError) {
    return NextResponse.json({ error: messageError.message }, { status: 500 })
  }
  await notifyClientOfFirmMessage(matterId!)
  return NextResponse.json({ success: true, channel, status: 'posted' })
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/scheduling-link-send.test.ts tests/api-route-auth.test.ts`
Expected: PASS. (`api-route-auth` passes because the route contains `requireAdmin`.)

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/scheduling-links/send/route.ts tests/scheduling-link-send.test.ts
git commit -m "feat: scheduling-link send endpoint (email/sms/portal fan-out)"
```

---

### Task 6: Linkify portal messages

**Files:**
- Create: `lib/linkify.tsx`
- Modify: `app/(portal)/messages/MessageThread.tsx:186`, `app/admin/matters/[id]/tabs/messages.tsx:100`
- Test: `tests/linkify.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it } from 'vitest'
import { isValidElement } from 'react'
import { linkifyText } from '@/lib/linkify'

describe('linkifyText', () => {
  it('turns https URLs into anchors and leaves text alone', () => {
    const parts = linkifyText('Book here: https://calendly.com/x/y?a=1 thanks')
    expect(parts[0]).toBe('Book here: ')
    const anchor = parts[1]
    expect(isValidElement(anchor)).toBe(true)
    expect((anchor as React.ReactElement<{ href: string }>).props.href).toBe('https://calendly.com/x/y?a=1')
    expect(parts[2]).toBe(' thanks')
  })

  it('does not linkify javascript: or bare text', () => {
    const parts = linkifyText('javascript:alert(1) and plain words')
    expect(parts).toHaveLength(1)
    expect(parts[0]).toBe('javascript:alert(1) and plain words')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/linkify.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/linkify.tsx`**

```tsx
import type { ReactNode } from 'react'

const URL_PATTERN = /(https?:\/\/[^\s<>"']+)/g

/** Render plain text with http(s) URLs as safe external links. */
export function linkifyText(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  let lastIndex = 0
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0
    if (start > lastIndex) parts.push(text.slice(lastIndex, start))
    parts.push(
      <a
        key={`${start}-${match[0]}`}
        href={match[0]}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 break-all"
      >
        {match[0]}
      </a>,
    )
    lastIndex = start + match[0].length
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts.length ? parts : [text]
}
```

- [ ] **Step 4: Apply in both renderers**

`app/(portal)/messages/MessageThread.tsx` line 186: replace `{message.body}` with `{linkifyText(message.body)}` and add `import { linkifyText } from '@/lib/linkify'`.

`app/admin/matters/[id]/tabs/messages.tsx` line 100 (PortalMessagesSection): replace `<p className="whitespace-pre-wrap">{m.body}</p>` with `<p className="whitespace-pre-wrap">{linkifyText(m.body)}</p>` and add the same import.

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run tests/linkify.test.tsx && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add lib/linkify.tsx tests/linkify.test.tsx "app/(portal)/messages/MessageThread.tsx" "app/admin/matters/[id]/tabs/messages.tsx"
git commit -m "feat: linkify URLs in portal message rendering"
```

---

### Task 7: Settings plumbing + Calendly links settings card

**Files:**
- Modify: `lib/appointments/types.ts` (SchedulingSettings interface), `lib/appointments/settings.ts:17-118`, `app/api/admin/scheduling/settings/route.ts`
- Create: `app/admin/settings/CalendlyLinksSection.tsx`
- Modify: `app/admin/settings/StaffSettingsClient.tsx:659`

- [ ] **Step 1: Extend the settings type and read/write**

`lib/appointments/types.ts` — add to the `SchedulingSettings` interface:

```ts
  calendlyUrls: Partial<Record<import('@/lib/scheduling').MeetingTypeKey, string>>
```

`lib/appointments/settings.ts`:
- Add `calendly_urls: unknown` to `SchedulingSettingsRow` (line 17).
- Add `calendlyUrls: {},` to `defaults()` (line 34).
- In `getSchedulingSettings` add `calendly_urls` to the select list (line 58) and map `calendlyUrls: sanitizeCalendlyUrls(row.calendly_urls),` (import `sanitizeCalendlyUrls` from `@/lib/calendly/links`).
- In `UpdateSchedulingSettingsInput` add `calendlyUrls?: unknown`; in `updateSchedulingSettings` add:

```ts
  if (input.calendlyUrls !== undefined) patch.calendly_urls = sanitizeCalendlyUrls(input.calendlyUrls)
```

`app/api/admin/scheduling/settings/route.ts` — add `calendlyUrls?: unknown` to `PutBody.settings` and pass `calendlyUrls: s.calendlyUrls,` through in the `updateSchedulingSettings` call.

- [ ] **Step 2: Create `app/admin/settings/CalendlyLinksSection.tsx`**

```tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const MEETING_TYPES: Array<{ key: string; label: string }> = [
  { key: 'discovery_call', label: 'Discovery Call' },
  { key: 'pmps', label: 'Peace of Mind Planning Session' },
  { key: 'draft_review', label: 'Estate Plan Draft Review' },
  { key: 'client_call', label: 'Client Call' },
  { key: 'signing_appointment', label: 'Signing Appointment' },
]

export function CalendlyLinksSection() {
  const token = useAccessToken()
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!token) return
    fetch('/api/admin/scheduling/settings', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(json => setUrls({ ...(json.settings?.calendlyUrls ?? {}) }))
      .catch(() => toast.error('Failed to load Calendly links'))
      .finally(() => setLoading(false))
  }, [token])

  const save = useCallback(async () => {
    for (const [key, value] of Object.entries(urls)) {
      if (value && !value.startsWith('https://calendly.com/')) {
        const label = MEETING_TYPES.find(t => t.key === key)?.label ?? key
        toast.error(`${label}: links must start with https://calendly.com/`)
        return
      }
    }
    setSaving(true)
    try {
      const cleaned = Object.fromEntries(Object.entries(urls).filter(([, v]) => v.trim()))
      const res = await fetch('/api/admin/scheduling/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ settings: { calendlyUrls: cleaned } }),
      })
      if (!res.ok) throw new Error()
      toast.success('Calendly links saved')
    } catch {
      toast.error('Failed to save Calendly links')
    } finally {
      setSaving(false)
    }
  }, [token, urls])

  return (
    <section className="rounded-lg border p-4">
      <h3 className="text-sm font-semibold">Calendly booking links</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Paste each event type&apos;s booking page URL. These power &ldquo;Send scheduling
        link&rdquo; and &ldquo;Book for client&rdquo; on lead and matter pages.
      </p>
      <div className="mt-3 space-y-3">
        {MEETING_TYPES.map(type => (
          <div key={type.key} className="space-y-1">
            <Label htmlFor={`calendly-${type.key}`}>{type.label}</Label>
            <Input
              id={`calendly-${type.key}`}
              placeholder="https://calendly.com/…"
              value={urls[type.key] ?? ''}
              disabled={loading}
              onChange={e => setUrls(prev => ({ ...prev, [type.key]: e.target.value }))}
            />
          </div>
        ))}
      </div>
      <Button type="button" size="sm" className="mt-4" onClick={save} disabled={loading || saving}>
        {saving ? 'Saving…' : 'Save Calendly links'}
      </Button>
    </section>
  )
}
```

- [ ] **Step 3: Render it**

`app/admin/settings/StaffSettingsClient.tsx` — import `CalendlyLinksSection` (next to the line-25 import) and change line 659:

```tsx
      {tab === 'scheduling' && (
        <div className="space-y-6">
          <SchedulingSettingsSection />
          <CalendlyLinksSection />
        </div>
      )}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npx vitest run tests --silent 2>&1 | tail -5`
Expected: clean, suite green.

- [ ] **Step 5: Commit**

```bash
git add lib/appointments/types.ts lib/appointments/settings.ts app/api/admin/scheduling/settings/route.ts app/admin/settings/CalendlyLinksSection.tsx app/admin/settings/StaffSettingsClient.tsx
git commit -m "feat: Calendly booking links settings card"
```

---

### Task 8: `SendSchedulingLinkDialog`

**Files:**
- Create: `components/scheduling/SendSchedulingLinkDialog.tsx`

- [ ] **Step 1: Create the component**

```tsx
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export interface SchedulingLinkTarget {
  kind: 'lead' | 'matter'
  id: string
}

interface TypeOption {
  key: string
  label: string
  configured: boolean
  links: { email: string; sms: string; portal: string } | null
  embedUrl: string | null
}

interface DialogData {
  recipient: { name: string; email: string | null; phone: string | null }
  smsConfigured: boolean
  portalAvailable: boolean
  types: TypeOption[]
}

type Channel = 'email' | 'sms' | 'portal'

function defaultMessage(name: string, label: string, link: string): string {
  const first = name.split(' ')[0]
  return `Hi ${first},\n\nPlease use this link to schedule your ${label}:\n${link}\n\nIf none of the times work, let us know and we'll find one that does.`
}

export function SendSchedulingLinkDialog({
  target,
  open,
  onOpenChange,
}: {
  target: SchedulingLinkTarget
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const token = useAccessToken()
  const [data, setData] = useState<DialogData | null>(null)
  const [typeKey, setTypeKey] = useState<string>('')
  const [channel, setChannel] = useState<Channel>('email')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [dirty, setDirty] = useState(false)
  const [sending, setSending] = useState(false)

  const query = target.kind === 'lead' ? `leadId=${target.id}` : `matterId=${target.id}`

  useEffect(() => {
    if (!open || !token) return
    setData(null)
    fetch(`/api/admin/scheduling-links/send?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => res.json())
      .then((json: DialogData) => {
        setData(json)
        const firstConfigured = json.types.find(t => t.configured)
        setTypeKey(firstConfigured?.key ?? '')
        setChannel(json.recipient.email ? 'email' : 'sms')
        setDirty(false)
      })
      .catch(() => toast.error('Failed to load scheduling links'))
  }, [open, token, query])

  const selected = useMemo(
    () => data?.types.find(t => t.key === typeKey) ?? null,
    [data, typeKey],
  )

  // Keep the prefilled message in sync with type/channel until the user edits it.
  useEffect(() => {
    if (!data || !selected?.links) return
    setSubject(`Schedule your ${selected.label}`)
    if (!dirty) {
      setMessage(defaultMessage(data.recipient.name, selected.label, selected.links[channel]))
    }
  }, [data, selected, channel, dirty])

  const send = useCallback(async () => {
    setSending(true)
    try {
      const res = await fetch('/api/admin/scheduling-links/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          target: target.kind === 'lead' ? { leadId: target.id } : { matterId: target.id },
          meetingTypeKey: typeKey,
          channel,
          subject: channel === 'email' ? subject : undefined,
          message,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Send failed')
      toast.success(
        channel === 'portal' ? 'Posted to the client portal' : `Scheduling link ${json.status}`,
      )
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }, [token, target, typeKey, channel, subject, message, onOpenChange])

  const channelDisabled = (c: Channel): string | null => {
    if (!data) return 'Loading'
    if (c === 'email' && !data.recipient.email) return 'No email on file'
    if (c === 'sms' && !data.smsConfigured) return 'SMS not configured'
    if (c === 'sms' && !data.recipient.phone) return 'No phone on file'
    if (c === 'portal' && !data.portalAvailable) return 'Portal is for hired clients'
    return null
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send scheduling link</DialogTitle>
        </DialogHeader>
        {!data ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Appointment type</Label>
              <div className="flex flex-wrap gap-2">
                {data.types.map(type => (
                  <Button
                    key={type.key}
                    type="button"
                    size="sm"
                    variant={typeKey === type.key ? 'default' : 'outline'}
                    disabled={!type.configured}
                    title={type.configured ? undefined : 'Add the link in Settings → Scheduling'}
                    onClick={() => { setTypeKey(type.key); setDirty(false) }}
                  >
                    {type.label}
                  </Button>
                ))}
              </div>
              {!data.types.some(t => t.configured) && (
                <p className="text-xs text-destructive">
                  No Calendly links configured yet — add them in Settings → Scheduling.
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label>Send via</Label>
              <div className="flex gap-2">
                {(['email', 'sms', 'portal'] as const).map(c => {
                  const reason = channelDisabled(c)
                  return (
                    <Button
                      key={c}
                      type="button"
                      size="sm"
                      variant={channel === c ? 'default' : 'outline'}
                      disabled={Boolean(reason)}
                      title={reason ?? undefined}
                      onClick={() => setChannel(c)}
                    >
                      {c === 'email' ? 'Email' : c === 'sms' ? 'Text' : 'Portal'}
                    </Button>
                  )
                })}
              </div>
            </div>
            {channel === 'email' && (
              <div className="space-y-1">
                <Label htmlFor="scheduling-link-subject">Subject</Label>
                <Input
                  id="scheduling-link-subject"
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                />
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="scheduling-link-message">Message</Label>
              <Textarea
                id="scheduling-link-message"
                rows={7}
                value={message}
                onChange={e => { setMessage(e.target.value); setDirty(true) }}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={send}
                disabled={sending || !typeKey || !selected?.configured}
              >
                {sending ? 'Sending…' : 'Send'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/scheduling/SendSchedulingLinkDialog.tsx
git commit -m "feat: shared send-scheduling-link dialog"
```

---

### Task 9: `BookCalendlyDialog`

**Files:**
- Create: `components/scheduling/BookCalendlyDialog.tsx`

- [ ] **Step 1: Create the component**

```tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import type { SchedulingLinkTarget } from '@/components/scheduling/SendSchedulingLinkDialog'

interface TypeOption {
  key: string
  label: string
  configured: boolean
  embedUrl: string | null
}

export function BookCalendlyDialog({
  target,
  open,
  onOpenChange,
}: {
  target: SchedulingLinkTarget
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const token = useAccessToken()
  const [types, setTypes] = useState<TypeOption[]>([])
  const [typeKey, setTypeKey] = useState('')
  const [booked, setBooked] = useState(false)

  const query = target.kind === 'lead' ? `leadId=${target.id}` : `matterId=${target.id}`

  useEffect(() => {
    if (!open || !token) return
    setBooked(false)
    fetch(`/api/admin/scheduling-links/send?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => res.json())
      .then((json: { types: TypeOption[] }) => {
        setTypes(json.types)
        setTypeKey(json.types.find(t => t.configured)?.key ?? '')
      })
      .catch(() => toast.error('Failed to load Calendly links'))
  }, [open, token, query])

  // Calendly emits postMessage events when embed_domain/embed_type are set.
  useEffect(() => {
    if (!open) return
    function onMessage(event: MessageEvent) {
      if (event.origin !== 'https://calendly.com') return
      const eventName = (event.data as { event?: string })?.event
      if (eventName === 'calendly.event_scheduled') setBooked(true)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [open])

  const selected = types.find(t => t.key === typeKey)
  const iframeSrc = useMemo(() => {
    if (!selected?.embedUrl) return null
    const url = new URL(selected.embedUrl)
    url.searchParams.set('embed_domain', window.location.hostname)
    url.searchParams.set('embed_type', 'Inline')
    return url.toString()
  }, [selected])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Book for client</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Appointment type</Label>
            <div className="flex flex-wrap gap-2">
              {types.map(type => (
                <Button
                  key={type.key}
                  type="button"
                  size="sm"
                  variant={typeKey === type.key ? 'default' : 'outline'}
                  disabled={!type.configured}
                  title={type.configured ? undefined : 'Add the link in Settings → Scheduling'}
                  onClick={() => { setTypeKey(type.key); setBooked(false) }}
                >
                  {type.label}
                </Button>
              ))}
            </div>
          </div>
          {booked ? (
            <div className="rounded-md border border-green-600/30 bg-green-600/10 p-4 text-sm">
              Booked — the appointment will appear on the timeline as soon as Calendly
              confirms it.
            </div>
          ) : iframeSrc ? (
            <iframe
              key={iframeSrc}
              src={iframeSrc}
              title="Calendly booking"
              className="h-[600px] w-full rounded-md border"
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              No Calendly links configured — add them in Settings → Scheduling.
            </p>
          )}
          <div className="flex items-center justify-between">
            {iframeSrc && !booked ? (
              <a
                href={iframeSrc}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground underline underline-offset-2"
              >
                Open in new tab
              </a>
            ) : <span />}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {booked ? 'Done' : 'Close'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/scheduling/BookCalendlyDialog.tsx
git commit -m "feat: embedded Calendly book-for-client dialog"
```

---

### Task 10: Lead page entry points

**Files:**
- Modify: `components/leads/LeadTopActions.tsx`
- Modify: `app/admin/leads/[id]/LeadDetailClient.tsx`

- [ ] **Step 1: Add menu items to `LeadTopActions`**

Add to `Props`: `onSendSchedulingLink: () => void` and `onBookForClient: () => void`; destructure both. In `DropdownMenuContent` (line 88), add above the existing items:

```tsx
            <DropdownMenuItem onClick={onSendSchedulingLink}>
              Send scheduling link
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onBookForClient}>
              Book for client…
            </DropdownMenuItem>
```

Note the trigger button is `disabled={busy || hired}` (line 83) — change to `disabled={busy}` so hired leads can still reach these items; keep the snooze/reactivate items conditional as they are.

- [ ] **Step 2: Wire dialogs in `LeadDetailClient.tsx`**

Add imports and state near the other dialog state:

```tsx
import { SendSchedulingLinkDialog } from '@/components/scheduling/SendSchedulingLinkDialog'
import { BookCalendlyDialog } from '@/components/scheduling/BookCalendlyDialog'
// …
const [schedulingLinkOpen, setSchedulingLinkOpen] = useState(false)
const [bookForClientOpen, setBookForClientOpen] = useState(false)
```

Pass to `<LeadTopActions … onSendSchedulingLink={() => setSchedulingLinkOpen(true)} onBookForClient={() => setBookForClientOpen(true)} />` and render alongside the existing dialogs:

```tsx
<SendSchedulingLinkDialog
  target={{ kind: 'lead', id: lead.id }}
  open={schedulingLinkOpen}
  onOpenChange={setSchedulingLinkOpen}
/>
<BookCalendlyDialog
  target={{ kind: 'lead', id: lead.id }}
  open={bookForClientOpen}
  onOpenChange={setBookForClientOpen}
/>
```

(`lead.id` — use the same identifier the page already uses for its API calls.)

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npx vitest run tests --silent 2>&1 | tail -5`
Expected: clean, green.

- [ ] **Step 4: Commit**

```bash
git add components/leads/LeadTopActions.tsx "app/admin/leads/[id]/LeadDetailClient.tsx"
git commit -m "feat: lead-page scheduling link and book-for-client actions"
```

---

### Task 11: Matter page entry points

**Files:**
- Modify: `app/admin/matters/[id]/tabs/messages.tsx` (Communications tab header) and/or `app/admin/matters/[id]/MatterDetailClient.tsx`

- [ ] **Step 1: Add buttons + dialogs**

In `MatterDetailClient.tsx`, add the same two `useState` flags and render the two dialogs with `target={{ kind: 'matter', id: matterId }}` (use the matter id variable the component already holds). In the Communications tab area (where the channel sections from `tabs/messages.tsx` are rendered), add a small toolbar row above the sections:

```tsx
<div className="flex justify-end gap-2">
  <Button type="button" size="sm" variant="outline" onClick={() => setSchedulingLinkOpen(true)}>
    Send scheduling link
  </Button>
  <Button type="button" size="sm" variant="outline" onClick={() => setBookForClientOpen(true)}>
    Book for client…
  </Button>
</div>
```

If the Communications tab is composed inside `tabs/messages.tsx`, pass the two `onClick` callbacks down as props from `MatterDetailClient` rather than lifting dialog state into the tab file.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npx vitest run tests --silent 2>&1 | tail -5`
Expected: clean, green.

- [ ] **Step 3: Commit**

```bash
git add "app/admin/matters/[id]/MatterDetailClient.tsx" "app/admin/matters/[id]/tabs/messages.tsx"
git commit -m "feat: matter-page scheduling link and book-for-client actions"
```

---

### Task 12: Final verification

- [ ] **Step 1: Full suite**

Run: `npx vitest run 2>&1 | tail -5`
Expected: all files pass (baseline was 188 files / 1599 tests before this feature).

- [ ] **Step 2: Lint / typecheck / build**

Use the `next-build-validator` agent (or run `npm run lint && npx tsc --noEmit && npm run build:next`).
Expected: GREEN.

- [ ] **Step 3: Manual smoke (optional, needs dev stack)**

Apply the migration locally, configure one Calendly URL in Settings → Scheduling, then from a lead page: open "Send scheduling link", verify the prefilled message and channel gating; open "Book for client…" and verify the Calendly page renders in the iframe.

- [ ] **Step 4: Commit any stragglers**

```bash
git status --short   # should be clean
```

---

## Self-review notes

- Spec coverage: settings/config (Tasks 1, 7), link builder (2), email category (3), lead SMS (4), send endpoint incl. all channels + activity (5), linkification (6), send dialog (8), embed dialog incl. postMessage + new-tab fallback (9), entry points (10, 11), testing (each task + 12). Out-of-scope items from the spec have no tasks — intentional.
- The dialog GET returns per-channel links so the previewed message matches the sent utm_medium; POST tolerates edited messages by checking for the base URL and appending the canonical link when missing.
- Type consistency: `SchedulingLinkTarget` defined once in `SendSchedulingLinkDialog` and imported by `BookCalendlyDialog`; `ResolvedSmsTarget.matterId` widened to `string | null` — existing matter callsites construct it with a string, so no changes ripple.
