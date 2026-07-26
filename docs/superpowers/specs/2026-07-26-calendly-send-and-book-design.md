# Calendly link sending + in-app booking — design spec

Date: 2026-07-26
Status: approved (design), pending implementation
Depends on: PR #125 (Calendly webhook support, branch `claude/calcom-calendly-migration-83dcc5`)

## Problem

The firm is moving hosted booking pages to Calendly (webhook receive path shipped in PR #125), but staff have no way to (a) send a client the right Calendly link from inside the app, or (b) book a Calendly appointment on a client's behalf while on the phone. Today the app holds no Calendly URLs at all, leads have no send-email/send-SMS plumbing, and portal messages render links as dead text.

Calendly's API cannot create a booking on an invitee's behalf — someone must pick a slot on a Calendly page. "Book for client" therefore means staff drive the Calendly booking page inside the admin app, prefilled with the client's details.

## Decisions (user-confirmed)

1. **Create flow**: embedded Calendly booking page in an admin dialog; staff picks the slot. No single-use-link API integration.
2. **Recipients**: both lead and matter detail pages. Portal channel is matter-only (portal requires a hired client).
3. **URL config**: admin settings UI backed by the DB (`scheduling_settings`), not env vars.
4. **Portal delivery**: a message in the existing portal thread, with URL linkification added to message rendering.

## Architecture

Booking flow closes the loop through the already-shipped webhook: link/embed carries `utm_content=leadId:<uuid>` or `matterId:<uuid>` → client (or staff) books on Calendly → `invitee.created` webhook → `external_bookings` row, lead/matter auto-link, activity + matter date stamps. **No new sync code and no new state tracking.**

```
Settings → Scheduling (calendly_urls jsonb on scheduling_settings, id=1)
        │
        ▼
lib/calendly/links.ts ── buildCalendlyLink(url, {name, email, leadId?, matterId?, channel})
        │                  → ?name=&email=&utm_source=app&utm_medium=<channel>&utm_content=leadId:…
        ├───────────────────────────────┐
        ▼                               ▼
SendSchedulingLinkDialog          BookCalendlyDialog (iframe embed)
        │                               │ staff books; calendly.event_scheduled postMessage → success UI
        ▼                               ▼
POST /api/admin/scheduling-links/send   (no write — webhook handles sync)
   ├─ email  → sendEmail (new 'scheduling_link' category)
   ├─ sms    → sendOutboundSms (extended with lead target)
   └─ portal → messages insert (sender_role 'attorney') + notifyClientOfFirmMessage
        │
        └─ lead_activity / matter_activity row per send
```

## Components

### 1. Config & settings UI

- **Migration** `supabase/migrations/20260816000000_calendly_links_and_lead_sms.sql`:
  - `ALTER TABLE scheduling_settings ADD COLUMN IF NOT EXISTS calendly_urls jsonb NOT NULL DEFAULT '{}'::jsonb;` — map of `MeetingTypeKey` → Calendly booking URL.
  - `ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES client_intake(id) ON DELETE SET NULL;` plus index `(lead_id, created_at DESC)` where lead_id is not null. (`matter_id` is already nullable — no relaxation needed.)
- **Settings UI**: "Calendly booking links" card in `app/admin/settings/SchedulingSettingsSection.tsx` — one URL input per meeting type from `MEETING_TYPE_KEYS` (`lib/scheduling.ts`), labels from `meetingTypeForKey`. Saved through the existing scheduling-settings admin route (`app/api/admin/scheduling/settings`). Validation: empty or `https://calendly.com/…` (reject other origins).

### 2. Link builder — `lib/calendly/links.ts`

- `getCalendlyUrls(): Promise<Partial<Record<MeetingTypeKey, string>>>` — reads `scheduling_settings.calendly_urls` via admin client; tolerant of malformed entries (drop, don't throw).
- `buildCalendlyLink(url, opts: { name?: string; email?: string; leadId?: string; matterId?: string; channel: 'email' | 'sms' | 'portal' | 'staff' })` — appends Calendly native prefill (`name`, `email`) and `utm_source=app`, `utm_medium=<channel>`, `utm_content=leadId:<uuid>` or `matterId:<uuid>` (matterId wins if both passed; matches webhook parser in `lib/calendly/normalize.ts` `trackingId`).

### 3. Send dialog — `components/scheduling/SendSchedulingLinkDialog.tsx`

Shared by lead and matter pages (modeled on `app/admin/leads/SendEngagementDialog.tsx`). Props carry a target: `{ kind: 'lead' | 'matter'; id; name; email?; phone?; }`.

Flow: pick event type → pick channel → edit prefilled message → send.
- Event types fetched from `GET /api/admin/scheduling-links/send` (returns configured types + channel availability, e.g. `smsConfigured`); unconfigured types disabled with "Add the link in Settings → Scheduling".
- Channels: **Email** (disabled without target email), **Text** (disabled without phone or when SMS unconfigured), **Portal** (matter targets only).
- Default message per channel, containing the built link; subject default "Schedule your {label}" for email. Fully editable before send.

### 4. Send endpoint — `POST /api/admin/scheduling-links/send`

`requireAdmin`-guarded (satisfies `tests/api-route-auth.test.ts`). Body: `{ target: { leadId?: string; matterId?: string }, meetingTypeKey, channel: 'email' | 'sms' | 'portal', subject?, message? }`. Exactly one of leadId/matterId.

- Resolves recipient (lead: `client_intake` name/email/phone; matter: existing matter client lookup) and builds the link server-side — never trusting a client-supplied URL. Uses the caller's edited message, appending the link if it was removed; falls back to the default template when no message is given.
- **Email**: `sendEmail({ category: 'scheduling_link', … })`. New category in `lib/email/categories.ts` with `recipient: 'client'` — inherits kill-switch/redirect/allowlist/provider controls and the email-settings UI automatically. Relay the `SendEmailResult` status to the caller.
- **SMS**: `lib/sms/outbound.ts` gains `resolveLeadSmsTarget(leadId)` (reads `client_intake.phone`) and `sendOutboundSms` accepts a target carrying `leadId | matterId`; `sms_messages` row written with the matching FK. 503 when `!isSmsConfigured()` (mirrors `/api/admin/matters/[id]/send-sms`). Respect `MAX_SMS_BODY_LENGTH`.
- **Portal** (matter only): insert into `messages` with `sender_role: 'attorney'`, then `notifyClientOfFirmMessage(matterId)` — same behavior as the admin branch of `app/api/messages/route.ts`.
- **Activity**: lead sends log `lead_activity` (`email_sent` / `sms`, title "Scheduling link sent: {label}"); matter email/SMS log `matter_activity` as the existing send routes do; portal messages are their own record.

### 5. Portal linkification — `lib/linkify.tsx`

`linkifyText(text: string): ReactNode` — splits on `https?://` URLs, renders matches as `<a href target="_blank" rel="noopener noreferrer">`, everything else as plain text (React-escaped). Only http(s) schemes become anchors — `javascript:` etc. stay inert text. Applied in `app/(portal)/messages/MessageThread.tsx` and the portal-messages section of `app/admin/matters/[id]/tabs/messages.tsx` (both currently `whitespace-pre-wrap` plain text).

### 6. Book-for-client dialog — `components/scheduling/BookCalendlyDialog.tsx`

- Staff picks event type (same configured list), dialog embeds `buildCalendlyLink(url, { name, email, leadId|matterId, channel: 'staff' })` + `&embed_domain=<host>&embed_type=Inline` in an iframe (no CSP changes needed — the app sets none).
- Listens for Calendly's `calendly.event_scheduled` postMessage (origin-checked against `https://calendly.com`) → flips to a success state ("Booked — it will appear on the timeline shortly"). No app-side write: the webhook records the booking, links it via utm, logs activity, and stamps matter dates.
- Fallback: "Open in new tab" link in the dialog footer for iframe failures.

### 7. Entry points

- **Lead page**: two items in the `components/leads/LeadTopActions.tsx` "More actions" dropdown — "Send scheduling link", "Book for client…"; handlers in `app/admin/leads/[id]/LeadDetailClient.tsx`.
- **Matter page**: same two buttons in the Communications tab toolbar (`app/admin/matters/[id]/tabs/messages.tsx`).

## Error handling

| Condition | Behavior |
|---|---|
| No Calendly URLs configured | Dialog shows setup hint linking to Settings → Scheduling; endpoint 400s |
| Meeting type not configured | Option disabled in dialog; endpoint 400 |
| SMS unconfigured / no phone | Channel disabled with reason; endpoint 503 / 400 |
| No email on target | Email channel disabled; endpoint 400 |
| Email suppressed / redirected (test modes) | Endpoint relays `SendEmailResult`; toast reflects actual outcome |
| Portal channel on a lead target | Not offered in UI; endpoint 400 |
| Iframe blocked / load failure | "Open in new tab" fallback link |
| Invalid URL pasted in settings | Rejected client- and server-side (`https://calendly.com/` origin only) |

## Testing

- `tests/calendly-links.test.ts` — builder: prefill encoding, utm fields per channel, leadId/matterId precedence, origin validation of configured URLs.
- `tests/scheduling-link-send.test.ts` — endpoint: auth, each channel happy path (lead + matter), activity rows, link injected server-side, 400/503 paths, `SendEmailResult` relay.
- `tests/linkify.test.tsx` — URLs become anchors, `javascript:` stays text, plain text preserved.
- Settings save round-trip (extend existing scheduling-settings test if present).
- Existing suites must stay green; new admin route passes `tests/api-route-auth.test.ts` via `requireAdmin`.

## Out of scope

- Single-use Calendly link minting (API token) — revisit if link reuse becomes a problem.
- Scheduling-request tracking table / reminder nudges for unbooked links (approach C) — `external_bookings` + activity timelines already record outcomes.
- Cal.com removal (separate follow-up PR).
- Lead-scoped general email/SMS composers — only the scheduling-link send is lead-scoped here, but the SMS plumbing (`lead_id` on `sms_messages`) intentionally leaves the door open.
