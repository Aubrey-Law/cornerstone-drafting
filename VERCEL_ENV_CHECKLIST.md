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

Google Cloud and Azure Entra redirect URIs must point at **Supabase**, not this app:

- `https://<project-ref>.supabase.co/auth/v1/callback`

Run `node scripts/validateOAuth.mjs` after changing provider settings.

### Microsoft login (sign-in — separate from Outlook Graph below)

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

> **Note:** Microsoft **Graph** (Outlook send from Settings) uses a *different* Entra app and redirect (`/api/admin/microsoft/callback`) — see below. You can reuse one app with both redirect URIs, or register two apps.

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
| `MICROSOFT_GRAPH_REDIRECT_URI` | Must exactly match an Entra redirect URI on this host. Preferred: `https://<host>/api/admin/microsoft/callback`. Alias also supported: `https://<host>/api/microsoft/callback` |
| `MICROSOFT_GRAPH_TENANT_ID` | Optional; defaults to `common` |

Staff connect Outlook under **Settings**. Manual matter email uses Graph when connected; otherwise Resend `manual` category.

**Entra app registration:** Under **Authentication → Redirect URIs**, add the same URL as `MICROSOFT_GRAPH_REDIRECT_URI` (e.g. `https://cornerstone.aubreylegal.com/api/microsoft/callback` or `.../api/admin/microsoft/callback`). A mismatch causes 404 or `redirect_uri` token errors.

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
| `FIRMA_WEBHOOK_SECRET` | Shared secret used by the current app webhook URL query-string check |

Current webhook URL configured by the legacy integration:
`https://<host>/api/webhooks/esign?secret=<FIRMA_WEBHOOK_SECRET>`

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

## Not used in this app

- Lawmatics, DocuSeal / SignWell
- Leads CRM / unified admin inbox / AI email triage
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
