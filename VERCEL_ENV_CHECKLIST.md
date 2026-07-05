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

## Optional

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Design-sheet DOCX import and AI drafting fallback |
| `NEXT_PUBLIC_SENTRY_DSN` | Client error reporting |
| `SENTRY_AUTH_TOKEN` | Source map upload on production builds |
| `ADMIN_EMAIL` | Default admin contact email in server helpers |

## Not used in this app

The following from the full portal are **not** required:

- Lawmatics, Twilio, Cal.com, Microsoft Graph / OneDrive
- Resend / email kill switch (client plan-review email removed)
- Portal host split (`NEXT_PUBLIC_PORTAL_HOST`, `NEXT_PUBLIC_APP_HOST`)
- DocuSeal / SignWell
