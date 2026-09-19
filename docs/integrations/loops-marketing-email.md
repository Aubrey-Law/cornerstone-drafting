# Loops marketing email

## Status: decided; blocked on DNS and two mailing lists

Resend keeps transactional email. Loops takes marketing, and **Loops owns consent** — this
application does not record it. Nothing has been sent yet: the sending domain and the mailing
lists do not exist, and neither can be created from the Loops API.

## Context

Marketing email was removed from this app deliberately, twice, and had never once been used.
`docs/superpowers/plans/2026-08-27-remove-crm-campaigns.md` records the production check
before removal — `campaigns=0, recipients=0, deliveries=0, last_send_at=null` — and
[#541](https://github.com/Aubrey-Law/cornerstone-drafting/pull/541) /
[#542](https://github.com/Aubrey-Law/cornerstone-drafting/pull/542) then dropped nine consent
columns and six campaign tables. That removal is not being undone. What comes back is the
capability, hosted elsewhere.

Resend has closed most of the historic feature gap — it now has Automations, Topics, Segments
and Broadcasts, whatever the comparison articles still say. The reason marketing went to Loops
anyway is narrow and worth stating plainly: Resend's automations trigger on custom events from
application code, which puts a developer in the loop for every campaign. Campaign creation
here is owned by a non-technical person, and Loops' visual editor is operable without touching
this repo.

Transactional did not move. Loops transactional templates must be authored and published in
the Loops dashboard and referenced by `transactionalId` — the body cannot be passed from code
— which would move all 20 categories in `lib/email/categories.ts` out of the firm's own admin
UI at `app/admin/settings`. Loops also gates attachments behind a support request, and
invoices already depend on Resend attachments (`lib/invoices/issue.ts`).

**This is not the Mailgun duplication** that `docs/architecture-assessment-2026-08-27.md:215`
criticized. That complaint was about two providers doing the same job. Here each owns a
distinct one, and the boundary is enforceable: Resend stores no contacts and sends no
campaigns; Loops sends no transactional mail.

## Loops owns consent

The opt-in is collected by Loops' own hosted form, which runs its own double opt-in and holds
subscription state. Loops is the sender, so it is the only store whose answer can actually
decide whether a message goes out.

A consent record was built in this app and then withdrawn —
[#549](https://github.com/Aubrey-Law/cornerstone-drafting/pull/549), closed unmerged. Two
stores of the same permission can disagree, and the one that does not gate sending is the one
that is wrong. Nothing from that branch reached `main`.

`tests/crm-hub.test.ts` already enforces this, and predates the decision:

```js
expect(read('packages/db-types/src/supabase.generated.ts')).not.toContain(`  ${column}: `)
```

over a list that includes `consent_source`, `consent_captured_at` and `unsubscribed_at`. #549
re-added all three; it passed CI only because its migration had not been applied and the
generated types had not been rewritten yet. **If a future change makes those columns reappear,
that test is the thing that will fail, and it is correct to fail.**

### The consequence that is easy to get wrong

Because consent lives in Loops and is given by a person filling in a form, **the app must not
bulk-push its client list into Loops as subscribed contacts.** Syncing `client_intake` or
`v_cornerstone_crm_people` into an audience does not create permission; it manufactures a list
of people who never opted in. Contacts enter Loops by opting in, not by being clients.

This is also why `contacts` must never be synced under any scheme: those rows are spouses,
children and fiduciaries attached to matters, and
`docs/matter-contacts-migration.md:817` notes most are people the firm has never met.

## What this app still owns

- Every transactional category in `lib/email/categories.ts`, through `lib/email/send.ts`.
- Delivery outcomes for Resend mail, via `app/api/webhooks/resend/route.ts`
  ([#547](https://github.com/Aubrey-Law/cornerstone-drafting/pull/547)). Requires
  `RESEND_WEBHOOK_SECRET`; without it the route 503s and bounces go unrecorded.
- Nothing about marketing consent, lists, segments, or unsubscribes.

## Setup runbook

### 1. Claim `news.aubreylegal.com` as the Loops sending domain

Use the subdomain, not the root, for two reasons that both matter:

- The root MX is Google Workspace (`0 smtp.google.com`) and carries staff mail. Loops needs an
  MX record on its own MAIL FROM subdomain for bounce feedback. A subdomain keeps those from
  ever being the same record.
- Reputation isolation. The root currently carries engagement-agreement signing links and
  invoices through Resend. A complaint spike on a newsletter must not be able to affect whether
  a signing link arrives.

Resend already uses this exact shape on the domain, which is the proof two providers coexist:

| Record | Value | Owner |
|---|---|---|
| `resend._domainkey` TXT | `p=MIGfMA0GCSqG…` | Resend DKIM |
| `send.aubreylegal.com` TXT | `v=spf1 include:amazonses.com ~all` | Resend MAIL FROM SPF |
| `send.aubreylegal.com` MX | `10 feedback-smtp.us-east-1.amazonses.com` | Resend bounce feedback |
| `_dmarc` TXT | `v=DMARC1; p=none; rua=mailto:scott@aubreylegal.com; fo=1` | both |

Loops uses a different DKIM selector, so there is no collision.

In Loops: **Settings → Domain**, add `news.aubreylegal.com`, then **View records** — the values
are generated per account and only exist after the domain is added. Add exactly those in
Cloudflare.

**Set every DKIM CNAME to "DNS only" (grey cloud), not proxied.** Cloudflare defaults new
CNAMEs to proxied, which replaces the record with Cloudflare's own IPs. A proxied DKIM CNAME
cannot be resolved by a receiving mail server, so verification fails and mail goes out
unsigned. This is the most common way this setup fails, and it presents as "Loops won't
verify" rather than as anything about proxying.

**Do not add Loops' SPF include to the root SPF record.** The root is already
`v=spf1 include:_spf.google.com include:spf.protection.outlook.com ~all` — two of the ten
lookups SPF permits. Loops' SPF belongs on its own subdomain. (Separately: that
`spf.protection.outlook.com` include is stale — Microsoft Graph was retired and staff mail is
Google. Worth removing on its own.)

Verify before clicking Verify in Loops:

```bash
dig +short TXT news.aubreylegal.com; dig +short MX news.aubreylegal.com
```

A DKIM CNAME resolving to a Cloudflare IP rather than a Loops hostname is still proxied.

`_dmarc` is `p=none`, which subdomains inherit, so nothing is rejected during setup. If DMARC
is ever tightened, both Resend and Loops must stay DKIM-aligned.

### 2. Two mailing lists

The Loops API cannot create these (`/v1/lists` is GET only), so this is dashboard work:
**Audience → Lists**. Two, reusing the segment model the deleted campaign system already
defined (`supabase/migrations/20260901000000_cornerstone_crm_mailgun_campaigns.sql` had
`prospect_nurture | client_newsletter | excluded`):

| List | Who | Why separate |
|---|---|---|
| Client newsletter | People the firm has a relationship with | Different consent basis and content from a cold prospect |
| Prospect nurture | Enquirers who have not engaged | Solicitation expectations differ |

`excluded` is not a list — it is the absence of both, plus Loops' own `subscribed: false`.

### 3. Contact properties — already created

Created via `POST /v1/contacts/properties`. **Loops has no delete endpoint for properties**, so
these are permanent:

| Property | Type | Still useful? |
|---|---|---|
| `lifecycleStatus` | string | Yes — mirrors `cornerstone_crm_people.lifecycle_status` for segmenting |
| `consentSource` | string | Redundant. Created when the app was to hold the consent record; Loops has its own `source` |
| `consentCapturedAt` | date | Redundant, same reason |

The two redundant ones cannot be removed. Leaving them documented as redundant is better than
leaving the next person to guess whether they are load-bearing.

`userGroup` is Loops' own primary segmentation axis and carries `client` / `prospect`; no
custom property should duplicate that.

## Open

- The sending domain and the two mailing lists, above. Both are Scott's — DNS is on Cloudflare
  and there is no API for either.
- Whether the app pushes contacts to Loops at all. Given that consent is given by opting in,
  the default answer is no, and Loops' form is the only way in. Any sync proposal has to
  explain where the permission came from.
- Stale Resend API keys: `Perpexity`, `Lovable`, `Railway`, plus an audit of `Portal`,
  `Onboarding` and `Supabase2`. Resend exposes no last-used timestamp, so rotate rather than
  revoke — mint a new key, swap it in Vercel, confirm a send, then revoke the rest. Also closes
  task 2.2.7 in `docs/superpowers/plans/2026-08-28-cornerstone-scope-reduction.md`.
