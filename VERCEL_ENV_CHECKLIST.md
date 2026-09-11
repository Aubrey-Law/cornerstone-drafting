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

Google Cloud and Azure Entra redirect URIs must point at **Supabase**, not this app:

- `https://<project-ref>.supabase.co/auth/v1/callback`

Run `node scripts/validateOAuth.mjs` after changing provider settings.

### Microsoft login (staff sign-in only)

The login page uses Supabase provider `azure` (“Continue with Microsoft”). No extra Vercel env vars are required beyond `NEXT_PUBLIC_APP_URL` and the Supabase keys.

**1. Azure Entra app registration** (portal.azure.com → Microsoft Entra ID → App registrations → New registration)

| Field | Value |
|-------|-------|
| Name | e.g. `Cornerstone Lite` |
| Supported account types | **Single tenant** (Aubrey org only) recommended for staff |
| Redirect URI (Web) | `https://<project-ref>.supabase.co/auth/v1/callback` |

After create:

1. **Certificates & secrets** → New client secret → copy the **Value** (not the Secret ID).
2. Note **Application (client) ID** and **Directory (tenant) ID**.

Optional Entra settings if sign-in fails with “Error getting user email”:

- Ensure each user has a **mail** / **user principal name** with an email.
- API permissions: `openid`, `profile`, `email` (Microsoft Graph delegated) — usually granted by default for sign-in.

**2. Supabase** → Authentication → Providers → **Azure**

| Field | Value |
|-------|-------|
| Enable Azure | On |
| Client ID | Entra Application (client) ID |
| Client Secret | Entra secret **Value** |
| Azure Tenant URL | `https://login.microsoftonline.com/<tenant-id>` for org-only, or `https://login.microsoftonline.com/common` for multi-tenant |

Common misconfiguration: putting the Supabase `/auth/v1/callback` URL in **Azure Tenant URL** — that field must be `https://login.microsoftonline.com/...`.

**3. Supabase** → Authentication → URL Configuration → **Redirect URLs**

Add every app host (see list above). Site URL should match your primary deployment.

**4. Staff access rules (this app)**

- OAuth auto-creates `public.users` on first sign-in.
- Staff admin routes require `role` in (`attorney`, `admin`) **and** an `@aubreylegal.com` email (enforced in `/auth/callback`).
- Non-firm Microsoft accounts become `client` and land on `/dashboard`.

**5. Verify**

```bash
node scripts/validateOAuth.mjs https://<your-host>
```

Expect `✓ azure: redirects to provider login`. Then click **Continue with Microsoft** on `/auth/login`.

> **Note:** this is sign-in only. Microsoft **Graph** (Outlook send and calendar) has been retired — see *Retired — Microsoft Graph* below.

## Optional — Granola (meeting notes import)

| Variable | Purpose |
|----------|---------|
| `GRANOLA_API_KEY` | Personal API key from Granola desktop → Settings → API (starts with `grn_`). Powers **Add meeting notes** on matter detail — lists recent meetings and pulls AI summaries into internal `meeting-notes` documents. |

Without this key, staff can still paste notes manually in the dialog; Granola list/fetch returns a clear configuration error.

## Optional — drafting / ops

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Design-sheet DOCX import and AI drafting fallback |
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

## Optional — Resend (lite alerts)

| Variable | Purpose |
|----------|---------|
| `RESEND_API_KEY` | Transactional email (message alerts, intake complete) |
| `EMAILS_ENABLED` | Hard kill switch (`false` / `0` / `off` suppresses all sends) |

Categories used: `message_alert`, `portal_message_notice`, `intake_complete_alert`, `intake_invite`, `manual`. No full portal email-settings matrix.

## Optional — Twilio (SMS + softphone)

Twilio remains available as a rollback provider. Select providers independently with
`SMS_PROVIDER=twilio` and `VOICE_PROVIDER=twilio`.

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

## Optional — Telnyx (SMS + softphone)

Set `SMS_PROVIDER=telnyx` and/or `VOICE_PROVIDER=telnyx` to activate Telnyx.

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

## Retired — Microsoft Graph (Outlook send and calendar)

`MICROSOFT_GRAPH_CLIENT_ID`, `MICROSOFT_GRAPH_CLIENT_SECRET`,
`MICROSOFT_GRAPH_REDIRECT_URI` and `MICROSOFT_GRAPH_TENANT_ID` are no longer
read for any new work. Nothing is written to Outlook and no mail is sent
through Graph; there is no longer a way to connect an Outlook mailbox.

Leave the variables in place while any appointment booked before the switchover
is still in the future: those rows carry a `microsoft_event_id`, and cancelling
or moving one has to happen in Outlook, which is the only calendar that holds
it. Once none remain, remove the variables and disconnect under
**Settings → Outlook (legacy)** — that tab disappears with the connection.

Staff sign-in with Microsoft is a **separate** thing and is unaffected; see
*Microsoft login* above.

## Optional — Retell

| Variable | Purpose |
|----------|---------|
| `RETELL_API_KEY` | Verify Retell webhook signatures (must be the key with the **webhook** badge in Retell) |
| `RETELL_SUMMARY_TO` | Comma-separated emails for post-call summary alerts (default `scott@aubreylegal.com`) |
| `RETELL_SUMMARY_SMS_TO` | E.164 mobile for SMS post-call alerts (optional; requires Twilio SMS) |

Webhook URL: `https://<host>/api/webhooks/retell`

On `call_analyzed`, Cornerstone upserts the call and emails/SMS the summary (`retell_call_alert` category).

## Optional — Firma.dev (engagement e-signature)

The current production routes use the legacy template-based flow, so the template IDs below remain required for the corresponding solo and joint paths. The planned document-based flow is not production-ready: its POC confirmed `FIRMA_API_KEY` authentication and the document lifecycle, but layout/anchor behavior, two-signer ordering, and webhook contract verification remain blocked. Do not remove the template IDs or add new document-flow secrets until that implementation replaces the legacy routes.

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

Booking metadata from Cal.com embeds (`metadata.leadId`, `metadata.matterId`) improves linking; without it, matching falls back to attendee email and auto-creates leads for discovery/PMPS event types.

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
