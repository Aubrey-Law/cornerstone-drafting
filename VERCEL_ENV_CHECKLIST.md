# Vercel environment checklist — Cornerstone Drafting

## Required

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (browser + SSR) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side admin queries and document writes |
| `R2_ACCOUNT_ID` | Cloudflare R2 account |
| `R2_ACCESS_KEY_ID` | R2 API key |
| `R2_SECRET_ACCESS_KEY` | R2 API secret |
| `R2_BUCKET_NAME` | Private documents bucket name. Required in production — the app refuses to fall back to a default bucket. |

## Estate generator

| Variable | Purpose |
|----------|---------|
| `ESTATE_GENERATOR_ENGINE` | `node` (default). `supabase` uses Storage templates. |
| `ESTATE_DRAFT_LLM_FALLBACK_ENABLED` | Off unless set to `true`. Allows a failed template render to fall back to drafting the document with the model. Leave unset: with it off a template failure surfaces as an error instead of producing AI-written text in a client instrument. |
| `ESTATE_CLAUSE_SOURCE` | `file` (default and rollback setting) or `database`. Keep production on `file` until the estate-clause release gate in `OPERATIONS_RUNBOOK.md` is green in preview. This is server-only; never prefix it with `NEXT_PUBLIC_`. |

## Shared fields package

`@aubrey-law/estate-fields` lives at `packages/estate-fields/` and is owned by this repository — it is a workspace member, not a vendored mirror, so there is nothing to sync inward and no sibling checkout to arrange. Registry changes land here first; see that package's `SYNC.md` for how other applications consume it.

## Auth / OAuth (recommended)

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_APP_URL` | Canonical public origin (e.g. `https://cornerstone.aubreylegal.com`). Used when resolving post-login redirects behind proxies. |
| `NEXT_PUBLIC_PORTAL_URL` | Optional dedicated client-facing origin. Standing intake links use this first and fall back to `NEXT_PUBLIC_APP_URL`. |
| `INTAKE_LINK_SIGNING_SECRET` | Server-only random secret used to sign stable, revocable intake URLs. Required in production; rotate only as an intentional invalidation of every standing link. |
| `TURNSTILE_SITE_KEY` | Cloudflare Turnstile site key rendered by the server on the public `/intake/start` page. |
| `TURNSTILE_SECRET_KEY` | Server-only Cloudflare Turnstile verification secret for public intake registration. |

Supabase Dashboard → Authentication → URL Configuration must include every deployed host:

- `https://cornerstone.aubreylegal.com/auth/callback`
- `https://cornerstone-drafting.vercel.app/auth/callback`
- `http://localhost:3002/auth/callback` (local dev)

Google Cloud redirect URIs must point at **Supabase**, not this app:

- `https://<project-ref>.supabase.co/auth/v1/callback`

Run `node scripts/validateOAuth.mjs` after changing provider settings.

## Optional — Granola (meeting notes import)

| Variable | Purpose |
|----------|---------|
| `GRANOLA_API_KEY` | Personal API key from Granola desktop → Settings → API (starts with `grn_`). Powers **Add meeting notes** on matter detail — lists recent meetings and pulls AI summaries into internal `meeting-notes` documents. |

Without this key, staff can still paste notes manually in the dialog; Granola list/fetch returns a clear configuration error.

## Optional — Statular lifecycle synchronization

| Variable | Purpose |
|----------|---------|
| `STATULAR_CLIENT_WEBHOOK_URL` | Server-only secret URL for Statular's create-client webhook. HTTPS required; production host must be `api.statular.com`. |
| `STATULAR_MATTER_WEBHOOK_URL` | Optional until matter creation ships. Server-only secret URL for Statular's create-matter webhook, with the same HTTPS/host requirements. |
| `STATULAR_WEBHOOK_GENERATION` | Required nonblank, non-secret generation such as `v1`, used in durable delivery identities. Increment whenever either webhook URL rotates. |

The webhook URLs are credentials: store them only in server environment secrets;
never use `NEXT_PUBLIC_`, return them to browsers, or put them in logs/errors.
Readiness responses expose booleans only. The client URL and the generation are
required for client delivery; the matter URL only for matter delivery. Configuration alone does not enable the automatic push: turn it on in
**Settings → Statular** ("Create Statular client when a lead is marked a fit").
A Statular client is created when staff set a lead's **Fit decision** to Fit
(key dates in the task plan) — not at booking — so not-a-fit leads never reach
Statular, which cannot delete records. Staff can also create it on demand with
**Push to Statular** in the lead or matter actions menu; that needs the client
webhook configured but not the sync toggle, and a repeat push reuses the stored client. Statular creates clients and matters independently of Lawmatics and does not update
existing Statular records. Existing Markdown export and drafting are unchanged.

## Optional — drafting / ops

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Design-sheet DOCX import, AI drafting fallback, and the review/field-audit run queue (`/api/cron/run-queue` answers 503 and leaves runs queued without it) |
| `USER_API_KEYS_ENCRYPTION_SECRET` | Encrypts staff BYOK API keys + MCP auth blobs at rest (required for Settings → API Keys / Connectors) |
| `DOCX_PDF_CONVERT_URL` | Base URL of the LibreOffice convert worker (e.g. `https://cornerstone-docx-pdf.fly.dev`) |
| `DOCX_PDF_CONVERT_SECRET` | Shared bearer secret sent to the convert worker (`CONVERT_WORKER_SECRET` on the worker) |
| `NEXT_PUBLIC_SENTRY_DSN` | Client error reporting |
| `SENTRY_AUTH_TOKEN` | Source map upload on production builds |
| `ADMIN_EMAIL` | Default admin contact email in server helpers |

`DOCX_PDF_CONVERT_URL` is only optional for invoices, which fall back to the
Word file and say so on the invoice. An invoice issued while the worker was
unreachable keeps whatever it got until **Generate PDF** is used on the
invoice, which re-renders it — no number is taken and nothing is re-sent.

The worker is scale-to-zero on Fly, so the first conversion after an idle
period pays a LibreOffice cold start. Routes that call it therefore set
`export const maxDuration = 120` to match the client's own ceiling; without
that the platform default can cut the request off mid-conversion, and because
the invoice number is assigned first, that leaves a real issued invoice with
no document attached at all.

## Optional — online invoice payment

Absent by default. With `PAYMENTS_PROVIDER` unset the checkout route returns
503, the **Create pay link** button never renders, and the firm keeps pasting a
payment link by hand — exactly as it did before this existed.

No trust accounting is involved: the firm bills flat fees earned on receipt and
does not run client funds through IOLTA, so payments land in operating. If that
ever changes, payments need a trust/operating destination *before* checkout is
switched on — money that should have been held in trust cannot be re-routed
after the fact.

| Variable | Purpose |
|----------|---------|
| `PAYMENTS_PROVIDER` | `stripe`. Unset disables online payment; LawPay is not implemented. |
| `STRIPE_SECRET_KEY` | Stripe server API key, for creating checkout sessions |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…`, verifies the webhook signature |

Register the endpoint as `https://{app}/api/webhooks/payments` and subscribe it
to `checkout.session.completed`, `checkout.session.expired` and
`checkout.session.async_payment_failed`. `NEXT_PUBLIC_APP_URL` and
`NEXT_PUBLIC_PORTAL_URL` already exist and supply the return URLs.

Stripe is the implemented online processor. LawPay is unsupported; changing the environment variable does not add an integration.

## Optional — Mercury bank reconciliation

Absent by default. With `MERCURY_API_TOKEN` unset the Bank deposits card never
renders and `/api/admin/billing/mercury/deposits` returns 503 — every other
billing surface is unchanged.

Read-only, in both directions. It reads Mercury and reads the ledger; it writes
nothing to either. Deposits are matched against open invoices and *proposed*, so
recording a payment stays a decision a person makes.

| Variable | Purpose |
|----------|---------|
| `MERCURY_API_TOKEN` | A **Read Only** token from the Mercury dashboard (Settings → API Tokens). Unset disables the feature. |
| `MERCURY_INCOME_ACCOUNT_IDS` | Comma-separated Mercury account IDs that receive client money. Required when the token is set. Currently the Income account, `40e1b452-85d1-11f1-92ba-23367ea93847` (Mercury Checking ••0876). |
| `MERCURY_API_BASE_URL` | Optional. Defaults to `https://api.mercury.com/api/v1`; only `api-sandbox.mercury.com` is otherwise accepted. |

Mint a **Read Only** token, not Read-and-Write. Read-only needs no IP
allowlisting, which is what lets this run on Vercel at all; a write token
requires a whitelisted static egress IP that serverless does not have. See the
[Mercury bank integration](docs/integrations/mercury-bank-reconciliation.md) plan before
attempting to push invoices into Mercury.

The account allowlist is deliberately not defaulted. With it unset every deposit
classifies as "other account" and the card says so — a legible failure, where a
guessed account would produce a confident, wrong worklist.

**Mercury deletes an API token after 45 days with no activity**, and downgrades
a Read-and-Write token to read-only after 45 days with no *write*. Neither is
recoverable; mint a new token. A dead token shows as "Reconnect Mercury" on the
billing page rather than an error.

## Optional — Resend (transactional email)

| Variable | Purpose |
|----------|---------|
| `RESEND_API_KEY` | Transactional email sending |
| `RESEND_WEBHOOK_SIGNING_SECRET` | Signing secret (`whsec_…`) for `/api/webhooks/resend`; without it the route 503s and bounces go unrecorded |
| `RESEND_FROM` | From address. Falls back to `"{attorneyShortName} <{firm.email}>"` |
| `EMAILS_ENABLED` | Hard kill switch (`false` / `0` / `off` suppresses all sends) |
| `EMAIL_ALLOWLIST` | Comma-separated recipients; anything else is suppressed and logged |
| `EMAIL_TEST_INBOX` | Recipient for categories in `redirect` mode (default `scott@aubreylegal.com`) |

All 20 categories in `lib/email/categories.ts` route through `lib/email/send.ts`. Per-category
`on` / `off` / `redirect` and the `resend` / `gmail` provider choice live in the `email_settings`
table, editable at **/admin/settings** — not in env. Automated categories default to Resend;
`manual` defaults to Gmail so an attorney letter threads in their own Sent Mail.

Register the webhook at `https://{app}/api/webhooks/resend` and subscribe at minimum to
`email.bounced`, `email.complained` and `email.failed`. Nothing consumes delivery events
without it, which is how a sending reputation degrades unnoticed — and this is the same domain
that carries engagement-agreement signing links.

## Optional — Twilio (voice)

Twilio SMS is retired: `SMS_PROVIDER=twilio` never sends. Staff texting is Telnyx only
(see below). `VOICE_PROVIDER=twilio` remains for existing voice callbacks.

| Variable | Purpose |
|----------|---------|
| `TWILIO_ACCOUNT_SID` | Account SID |
| `TWILIO_AUTH_TOKEN` | Auth token (webhook signature verify) |
| `TWILIO_SMS_FROM` or `TWILIO_MESSAGING_SERVICE_SID` | Outbound SMS |
| `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` | Browser Voice SDK tokens |
| `TWILIO_TWIML_APP_SID` | TwiML App for outbound softphone |
| `TWILIO_CALLER_ID` | Outbound caller ID |
| `TWILIO_INBOUND_CLIENT_IDENTITIES` | Comma-separated staff user UUIDs to ring |
| `TWILIO_INBOUND_FALLBACK_URL` | Fallthrough (e.g. Retell) when no answer |
| `TWILIO_INBOUND_RING_TIMEOUT` | Seconds before fallback |
| `TWILIO_RECORD_CALLS` | Optional call recording |
| `TWILIO_WEBHOOK_BASE_URL` | Public base for status callbacks if different from `NEXT_PUBLIC_APP_URL` |

Point Twilio Voice / Messaging webhooks at this app’s host (`/api/webhooks/twilio/*`, `/api/voice/*`). Softphone FAB hides when Voice env is incomplete.

## Optional — Telnyx (staff texting + voice)

Staff texting (the Texts page and record Text composers) needs **both**
`SMS_PROVIDER=telnyx` and `MANUAL_COMMUNICATIONS_ENABLED=true`, plus
`TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY`, `TELNYX_PHONE_NUMBER` and
`TELNYX_MESSAGING_PROFILE_ID`. `SMS_PROVIDER` defaults to `none`; leftover
credentials alone never turn sending on. `VOICE_PROVIDER=telnyx` selects Telnyx voice.

| Variable | Purpose |
|---|---|
| `TELNYX_API_KEY` | Server API authentication |
| `TELNYX_PUBLIC_KEY` | Ed25519 webhook verification key |
| `TELNYX_PHONE_NUMBER` | New Telnyx number in E.164 format |
| `TELNYX_MESSAGING_PROFILE_ID` | Messaging Profile assigned to the number |
| `TELNYX_CONNECTION_ID` | Credential Connection used to mint Scott's softphone JWT (separate from inbound number routing) |
| `TELNYX_TELEPHONY_CREDENTIAL_IDS` | JSON map of Supabase user UUID to Telnyx telephony credential ID |
| `TELNYX_TELEPHONY_CREDENTIAL_ID` | Optional single-user credential fallback |
| `TELNYX_WEBHOOK_BASE_URL` | Optional public callback base; defaults to `NEXT_PUBLIC_APP_URL` |
| `TELNYX_RECORD_CALLS` | Optional `true` recording flag for portal routing configuration |
| `TELNYX_INBOUND_AGENT_SIP_URI` | Scott's inbound SIP target: `sip:gencredjEk3vUT63zmO3jSdGMWCDzKk5OzKUOAoUkomgBgGVX@sip.telnyx.com` |
| `TELNYX_INBOUND_RING_TIMEOUT` | `25` seconds before the fallback destination |
| `TELNYX_INBOUND_FALLBACK_DESTINATION` | Environment-configurable fallback; production value: `+13392381012` |

Configure the Messaging Profile webhook as `/api/webhooks/telnyx/messaging` and
the Credential Connection voice webhook as `/api/webhooks/telnyx/voice`. Those
two endpoints receive signed Telnyx API-v2 JSON events. Each staff softphone
user needs a distinct generated telephony credential.

Inbound calling uses a separate TeXML application:

1. On Scott's parent Credential Connection, set **Receive SIP URI Calls** to
   **From connections in this account** (`sip_uri_calling_preference:
   "internal"`). Do not use unrestricted SIP URI calling.
2. Associate an enabled Outbound Voice Profile with both the TeXML application
   and Scott's parent Credential Connection so the TeXML application's Dial can
   reach the generated SIP credential and the fallback PSTN number.
3. Assign the firm's Telnyx number to the TeXML application.
4. Set the TeXML application's Voice URL to
   `/api/voice/telnyx/inbound` using POST.
5. Set its call-progress/status callback to
   `/api/webhooks/telnyx/texml` using POST. TeXML status callbacks are signed
   `application/x-www-form-urlencoded` bodies; do not point them at the
   API-v2 JSON voice endpoint or label them API v2.

The admin-safe audit endpoint is `GET /api/admin/communications/status`.
Inbound readiness is true only when `VOICE_PROVIDER=telnyx`, outbound Telnyx
voice is ready, and the fixed SIP/fallback routing values validate.

## Google Calendar and Gmail

The firm's calendar and mailbox. One OAuth client and one consent cover both:
appointments and holds are written to Google Calendar, availability is read
from it, email categories set to *Gmail* send from the connected mailbox, and
email triage reads recent inbox threads and creates attorney-reviewed drafts.

| Variable | Purpose |
|----------|---------|
| `GOOGLE_CALENDAR_CLIENT_ID` | OAuth client ID from the Google Cloud console |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | OAuth client secret |
| `GOOGLE_CALENDAR_REDIRECT_URI` | Must exactly match an Authorised redirect URI on the OAuth client: `https://<host>/api/admin/google/callback` |

Connect at `/api/admin/google/connect`, or from **Settings → Google**.

**Google Cloud setup:** enable the **Google Calendar API** *and the **Gmail
API***, create an OAuth client of type *Web application*, and add the same URL
as `GOOGLE_CALENDAR_REDIRECT_URI` under **Authorised redirect URIs** — Google
matches it exactly, including scheme and any trailing slash.

**Scopes requested:** `openid`, `email`, `profile`,
`https://www.googleapis.com/auth/calendar` and
`https://www.googleapis.com/auth/gmail.send`, plus
`https://www.googleapis.com/auth/gmail.modify`. The modify scope lets email
triage inspect recent threads and save a draft on the thread being answered;
Cornerstone does not request the broader `mail.google.com` scope that permits
permanent deletion. It persists Gmail's snippet, not message bodies, and never
sends a triage draft without the attorney sending it from Gmail. A connection
made before either Gmail feature may be missing its required scope; Settings →
Google flags the missing send or triage permission and a reconnect fixes it.

**If a connection reports no refresh token:** Google issues one only on an
account's first consent, and Cornerstone asks for `prompt=consent` to force it.
Where an older grant is still in place, remove Cornerstone at
[myaccount.google.com/permissions](https://myaccount.google.com/permissions) and
connect again. The callback refuses to store a connection without one rather
than saving something that stops working within the hour.

## Optional — Microsoft Teams meetings

Lets appointments carry a Microsoft Teams join link instead of Google Meet. The
calendar stays on Google: Cornerstone creates a Teams meeting through Microsoft
Graph (`/me/onlineMeetings`) and puts its join link on the Google event and in
the client's confirmation and reminder emails. Staff choose **Microsoft Teams**
under *Video* when quick-booking a virtual meeting, or press **Add Teams
meeting** on an upcoming appointment in the calendar drawer.

| Variable | Purpose |
|----------|---------|
| `MICROSOFT_CLIENT_ID` | Application (client) ID of the Entra app registration |
| `MICROSOFT_CLIENT_SECRET` | A client secret *value* for that registration |
| `MICROSOFT_REDIRECT_URI` | Must exactly match a *Web* redirect URI on the registration: `https://<host>/api/admin/microsoft/callback` |
| `MICROSOFT_TENANT_ID` | The *Directory (tenant) ID* from the registration's Overview page. **Required for a single-tenant registration** (the recommended setup below): left unset, sign-in goes to the shared `organizations` endpoint, which Microsoft refuses for single-tenant apps with `AADSTS50194`. Only a multi-tenant registration can leave it unset |

Connect from **Settings → Google & Teams → Microsoft Teams**.

**Entra setup** (entra.microsoft.com, signed in as a Global or Application
Administrator):

1. **App registrations → New registration.** Supported account types:
   *Accounts in this organizational directory only (Single tenant)*. Redirect
   URI: platform *Web*, the same URL as `MICROSOFT_REDIRECT_URI`.
2. From **Overview**, copy the *Application (client) ID* into
   `MICROSOFT_CLIENT_ID` and the *Directory (tenant) ID* into
   `MICROSOFT_TENANT_ID`.
3. **Certificates & secrets → New client secret.** Copy the secret's
   **Value** (shown once) into `MICROSOFT_CLIENT_SECRET`, not its *Secret ID*,
   which Microsoft rejects with `AADSTS7000215`. Secrets expire (24 months at
   most), so note the date: Teams creation stops when it lapses.
4. **API permissions → Add a permission → Microsoft Graph → Delegated:**
   `OnlineMeetings.ReadWrite`, `offline_access`, `openid`, `email` (plus the
   default `User.Read`), then **Grant admin consent**.
5. Redeploy so the variables take effect, then connect from Settings with the
   work account that will host the meetings.

Teams meetings need a work or school account with a Teams licence; Graph
refuses them for personal Microsoft accounts. For local development, add
`http://localhost:3002/api/admin/microsoft/callback` as a second Web redirect
URI.

| Error | Cause |
|-------|-------|
| `AADSTS50011` | Redirect URI in Entra and `MICROSOFT_REDIRECT_URI` differ |
| `AADSTS50194` | `MICROSOFT_TENANT_ID` unset for a single-tenant registration |
| `AADSTS7000215` | Client secret is the *Secret ID*, or has expired |
| `AADSTS65001` | Admin consent was not granted |
| 403 when adding a meeting | The connected account has no Teams licence or a Teams meeting policy blocks it |

## Retired — Microsoft 365 (Outlook mail and calendar, Microsoft sign-in)

The firm runs on Google. Nothing in the app reads or writes Outlook, and the
"Continue with Microsoft" sign-in button is gone. (Teams meetings, above, are a
separate opt-in with their own `MICROSOFT_*` variables and never touch Outlook.)

These variables are no longer read by any code path and can be deleted from
Vercel and from every local env file:

- `MICROSOFT_GRAPH_CLIENT_ID`
- `MICROSOFT_GRAPH_CLIENT_SECRET`
- `MICROSOFT_GRAPH_REDIRECT_URI`
- `MICROSOFT_GRAPH_TENANT_ID`

In Supabase, **Authentication → Providers → Azure** can be disabled. Confirm
first that every account with an Azure identity also has a Google or
email + password identity, so disabling it locks nobody out.

## Optional — Retell

| Variable | Purpose |
|----------|---------|
| `RETELL_API_KEY` | Verify Retell webhook signatures (must be the key with the **webhook** badge in Retell) |
| `RETELL_SUMMARY_TO` | Comma-separated emails for post-call summary alerts (default `scott@aubreylegal.com`) |
| `RETELL_SUMMARY_SMS_TO` | E.164 mobile for SMS post-call alerts (optional; requires Twilio SMS) |

Webhook URL: `https://<host>/api/webhooks/retell`

On `call_analyzed`, Cornerstone upserts the call and emails/SMS the summary (`retell_call_alert` category).

## Engagement agreements (workspace flow)

Required by the agreement workspace at `/admin/engagements/[agreementId]` — preview, approve
and send — **whichever e-signature provider is selected**. Approve and send both fail without
it, and the failure is a plain `ENGAGEMENT_APPROVAL_SECRET is not configured` from
`lib/engagement/approval.ts`.

| Variable | Purpose |
|----------|---------|
| `ENGAGEMENT_APPROVAL_SECRET` | HMAC key signing the revision-approval token that the send step consumes. Any long random value (`openssl rand -base64 48`); mark it Sensitive. Rotating it only invalidates approval tokens not yet consumed, and those expire quickly. |

This one was missing from this checklist until 2026-09-15, so it was never set in production —
and nobody noticed, because production had only ever used the legacy template flow below, which
does not pass through the workspace. The first real run of the workspace flow failed on it.

### Signing-link origin

Native signing links are built from the first of these that is set
(`lib/esign/native.ts:39`), and sending fails outright if none is:

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_APP_URL` | Preferred. Already required above. |
| `NEXT_PUBLIC_SITE_URL` | Fallback. Only needed if `NEXT_PUBLIC_APP_URL` is unset. |
| `CORNERSTONE_ORIGIN` | Second fallback. Same. |

## Optional — Firma.dev (engagement e-signature)

Firma signs engagement agreements whenever `firm_settings.esign_native_enabled` is false, and
the **legacy template flow** (`/api/admin/{matters,leads}/[id]/engagement`) goes through Firma
regardless of that flag, so the template IDs below stay required until that flow is migrated.

The in-house engine replaced the abandoned Firma *document* flow: anchor geometry is verified
against a real LibreOffice render by `.github/workflows/esign-anchor-probe.yml`, and two-signer
ordering is settled by position rather than role. Native signing needs no Firma credential —
it needs `ENGAGEMENT_APPROVAL_SECRET`, an origin, R2 and `RESEND_API_KEY`, all above.

| Variable | Purpose |
|----------|---------|
| `FIRMA_API_KEY` | firma.dev API key (sent as the Authorization header) |
| `FIRMA_ENGAGEMENT_TEMPLATE_ID` | Single-signer engagement template (solo client) in firma.dev |
| `FIRMA_ENGAGEMENT_TEMPLATE_ID_JOINT` | Two-signer engagement template (client + spouse). Set your existing 2-signer template here to unblock couples; build a 1-signer template for `FIRMA_ENGAGEMENT_TEMPLATE_ID` to enable solo clients |
| `FIRMA_WEBHOOK_SECRET` | Current Firma webhook signing secret used to verify `X-Firma-Signature` timestamped HMACs |
| `FIRMA_WEBHOOK_SECRET_OLD` | Optional previous signing secret used only during Firma secret rotation |

Webhook URL: `https://<host>/api/webhooks/esign`

Do not put the signing secret in the URL. The route verifies Firma's signature
over the exact raw body with a five-minute timestamp tolerance and accepts
`X-Firma-Signature-Old` only when `FIRMA_WEBHOOK_SECRET_OLD` is configured.

On completion, Cornerstone stores the combined signed PDF + audit certificate in the
matter's Signed documents and checks "Engagement signed" on the matter.

## Deployments (cost control)

`vercel.json` limits **automatic** builds to **production (`main`)** only. PR/feature-branch pushes do not run the full estate-generator + Next build.

| Need | How |
|------|-----|
| Verify locally | `npm run dev` + local Supabase (see `AGENTS.md`) |
| Skip a `main` push | Include `[skip deploy]` in the commit message |
| Preview/staging URL | Vercel dashboard → **Deployments** → **Redeploy** on the branch you want |

No dashboard toggle is required for this policy — it is enforced by `vercel.json` plus `scripts/vercel-should-build.sh` (which also reads git when Vercel system vars are absent).

Optional: **Settings → Environment Variables** → **Enable access to System Environment Variables** (often already on). Not required for the build-skip script.

---

## After applying database migrations

Run `npm run check:db-rpcs` (needs `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`). It cross-checks every Supabase RPC the app calls against what PostgREST can actually resolve, and exits non-zero listing the call sites of anything missing.

Worth running because migration history is not proof of application: a row in `supabase_migrations.schema_migrations` can exist even though its SQL never executed, and `supabase db push` then skips that migration forever. That is exactly how `update_lead_opportunity_field` went missing while every inline lead edit failed in production with `PGRST202`.

## Not used in this app

- DocuSeal / SignWell
- Portal hostname split (`NEXT_PUBLIC_PORTAL_HOST`) — single host, role-based routing
- Full 12-category email settings matrix from aubrey-law-app

## Cal.com webhooks

| Variable | Purpose |
|----------|---------|
| `CALCOM_WEBHOOK_SECRET` | HMAC secret for `X-Cal-Signature-256` verification on `/api/webhooks/calcom` |

**Cal.com dashboard setup:**

1. Settings → Developer → Webhooks → Add webhook
2. Subscriber URL: `https://<production-host>/api/webhooks/calcom`
3. Triggers: `BOOKING_CREATED`, `BOOKING_RESCHEDULED`, `BOOKING_CANCELLED`
4. Secret: same value as `CALCOM_WEBHOOK_SECRET`
5. Local dev: tunnel to `http://localhost:3002` (e.g. ngrok or cloudflared)

Booking metadata (`metadata.leadId`, `metadata.matterId`) improves linking. Cal.com booking links configured in Settings → Scheduling carry it automatically (`metadata[leadId]` / `metadata[matterId]` query params on links sent from lead and matter pages); without it, matching falls back to attendee email and auto-creates leads for discovery/PMPS event types.

Each booking also gets a read-only mirror row in `appointments` (`source = 'calcom'`), so it shows on the admin calendar like a Calendly booking; rescheduling and cancelling happen in Cal.com. On `BOOKING_RESCHEDULED`, the row for the original booking (`rescheduleUid`) is cancelled and the new booking gets its own row. Event types map to meeting types by slug (`discoverycall`, `pmps`, `draft-review`, `currentclient`, `signing-appointment`, see `lib/scheduling.ts`); any other slug appears on the calendar as a Client Call labelled with the Cal.com title.

## Lawmatics calendar import

Lawmatics' outbound webhooks have no appointment events, so bookings made in Lawmatics (booking forms, staff scheduling) are pulled from the Lawmatics API by `lib/integrations/lawmatics/inbound.ts` and mirrored onto the admin calendar as read-only `source = 'lawmatics'` appointments. It uses the existing Lawmatics OAuth connection.

| Variable | Purpose |
|----------|---------|
| `LAWMATICS_CALENDAR_SYNC_ENABLED` | `true` turns the import on. Unset or anything else leaves it off (both the cron and the webhook no-op). |
| `LAWMATICS_WEBHOOK_SECRET` | The full `whsec_…` signing secret Lawmatics shows for the webhook; verifies `X-Lawmatics-Signature` on `/api/webhooks/lawmatics` |

- **Scheduled sync:** `/api/cron/lawmatics-calendar` (every 10 minutes, `CRON_SECRET`) scans events ending no earlier than 24 hours ago and starting within 180 days. It records new, moved, and cancelled bookings. Lawmatics deletes cancelled events, so an upcoming mirrored booking missing from the scan is checked by id and cancelled on a 404. This run is what picks up reschedules and cancellations.
- **Webhook (optional, faster):** in Lawmatics go to Settings → Webhooks → Add New Webhook. Set the URL to `https://<production-host>/api/webhooks/lawmatics` and the event type to form submitted. Put the signing secret in `LAWMATICS_WEBHOOK_SECRET`. A booking form's submission then triggers the import right away; other event types are acknowledged and ignored.
- **What is imported:** only events attached to a prospect or contact that has an email. All-day and staff-only events are skipped. So are events Cornerstone itself pushed to Lawmatics (appointment sync), which are recognized by their `integration_external_records` link or the "Cornerstone appointment reference" description, so the two directions never duplicate a meeting.
- **Booking links:** Lawmatics events carry no metadata, so a Lawmatics booking link sent from a lead or matter page (or opened with "Book for client") first runs Push to Lawmatics for that client (`lib/integrations/lawmatics/bookingLink.ts`). That creates or updates the prospect and records its link to the lead, and the link is prefilled with `first_name`, `last_name` and `email`. The booking then lands on that prospect and imports onto the lead and its matter. If the push fails (e.g. Lawmatics disconnected, lead missing a name), the link is still sent, staff see a warning, and the import falls back to email matching.
- **Linking and types:** the prospect links to its lead through the Push to Lawmatics / import record (or `client_intake.lawmatics_matter_id`), falling back to email. Event types map back to meeting types through the same Lawmatics event type ID map the outbound sync uses; unmapped types appear as a Client Call labelled with the Lawmatics event name.

## Calendly webhooks

Runs alongside the Cal.com path during the migration; both providers mirror into `external_bookings` with a `provider` column.

| Variable | Purpose |
|----------|---------|
| `CALENDLY_WEBHOOK_SECRET` | High-entropy shared secret placed in the subscribed callback URL's `token` query parameter and verified by `/api/webhooks/calendly` |
| `CALENDLY_WEBHOOK_SIGNING_KEY` | Optional legacy/future HMAC key if Calendly sends `Calendly-Webhook-Signature`; not used by current API v2 subscriptions |
| `CALENDLY_EVENT_TYPE_MAP` | JSON map of Calendly event-type UUID → meeting type key, e.g. `{"<uuid>":"discovery_call","<uuid>":"pmps","<uuid>":"draft_review","<uuid>":"client_call","<uuid>":"signing_appointment"}` |

**Calendly setup (requires Standard plan or above):**

1. Create a Personal Access Token (Integrations → API & Webhooks) with `scheduled_events:read`, `webhooks:read`, and `webhooks:write` scopes.
2. `GET https://api.calendly.com/event_types?organization=<org uri>` — collect the UUID of each event type and build `CALENDLY_EVENT_TYPE_MAP`. Without the map, event types fall back to case-insensitive name matching against the meeting-type labels ("Discovery Call", "Peace of Mind Planning Session", …). Unmatched bookings still appear on the calendar under the neutral Client Call type, while preserving the actual Calendly label.
3. Generate a high-entropy `CALENDLY_WEBHOOK_SECRET` (at least 32 random bytes) and set it as a Sensitive Vercel variable.
4. `POST https://api.calendly.com/webhook_subscriptions` with `{ "url": "https://<production-host>/api/webhooks/calendly?token=<CALENDLY_WEBHOOK_SECRET>", "events": ["invitee.created", "invitee.canceled"], "organization": "<org uri>", "scope": "organization" }`. Calendly API v2 does not return a signing key or document an HMAC signature header, so the callback secret is required.
5. Set `CALENDLY_EVENT_TYPE_MAP` in Vercel and redeploy after either variable changes.
6. Local dev: set the same callback secret locally and tunnel to `http://localhost:3002` (e.g. ngrok or cloudflared).

Lead/matter hints can be passed on scheduling links via `utm_content=leadId:<uuid>` or `utm_content=matterId:<uuid>`; otherwise matching falls back to invitee email. On every new Calendly booking, Cornerstone refreshes the matched contact (without replacing an existing legal name), updates its CRM opportunity through the existing intake sync, or creates a new contact/opportunity when no match exists. The booking is mirrored into the Cornerstone calendar and remains read-only there; cancellations and reschedules must be made in Calendly and arrive through the webhook.
