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
| `R2_BUCKET` | Private documents bucket name |

## Estate generator

| Variable | Purpose |
|----------|---------|
| `ESTATE_GENERATOR_ENGINE` | `node` (default). `supabase` uses Storage templates. `python` is reserved for subprocess tooling; bulk runs use node → supabase → per-doc fallback. |

Python fallback uses the venv created by `npm run estate-generator:setup` during build.

## Shared fields package

`@aubrey-law/estate-fields` is vendored at `packages/estate-fields/` for Vercel and standalone clones. Sync registry changes from `aubrey-law-app/packages/estate-fields` (see that package's `SYNC.md`).

## Auth / OAuth (recommended)

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_APP_URL` | Canonical public origin (e.g. `https://cornerstone.aubreylegal.com`). Used when resolving post-login redirects behind proxies. |

Supabase Dashboard → Authentication → URL Configuration must include every deployed host:

- `https://cornerstone.aubreylegal.com/auth/callback`
- `https://cornerstone-drafting.vercel.app/auth/callback`
- `http://localhost:3002/auth/callback` (local dev)

Google Cloud and Azure Entra redirect URIs must point at Supabase, not this app:

- `https://<project-ref>.supabase.co/auth/v1/callback`

Run `node scripts/validateOAuth.mjs` after changing provider settings.

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

## Optional — Resend (lite alerts)

| Variable | Purpose |
|----------|---------|
| `RESEND_API_KEY` | Transactional email (message alerts, intake complete) |
| `EMAILS_ENABLED` | Hard kill switch (`false` / `0` / `off` suppresses all sends) |

Categories used: `message_alert`, `portal_message_notice`, `intake_complete_alert`, `intake_invite`, `manual`. No full portal email-settings matrix.

## Optional — Twilio (SMS + softphone)

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

## Optional — Microsoft Graph (Outlook send)

| Variable | Purpose |
|----------|---------|
| `MICROSOFT_GRAPH_CLIENT_ID` | Entra app client ID |
| `MICROSOFT_GRAPH_CLIENT_SECRET` | Entra app secret |
| `MICROSOFT_GRAPH_REDIRECT_URI` | Must match `/api/admin/microsoft/callback` on this host |
| `MICROSOFT_GRAPH_TENANT_ID` | Optional; defaults to `common` |

Staff connect Outlook under **Settings**. Manual matter email uses Graph when connected; otherwise Resend `manual` category.

## Optional — Retell

| Variable | Purpose |
|----------|---------|
| `RETELL_API_KEY` | Verify Retell webhook signatures |

Webhook URL: `https://<host>/api/webhooks/retell`

## Not used in this app

- Lawmatics, Cal.com, DocuSeal / SignWell
- Leads CRM / unified admin inbox / AI email triage
- Portal hostname split (`NEXT_PUBLIC_PORTAL_HOST`) — single host, role-based routing
- Full 12-category email settings matrix from aubrey-law-app
