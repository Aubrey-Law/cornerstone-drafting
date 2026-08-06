# Cornerstone Lite

A Next.js practice app for estate-planning **intake**, **matters**, **document sharing**, **aging**, **communications**, and **drafting**.

Drafting (design sheet → generate → review) lives in this repo and is the source of truth. Do **not** port drafting code from `aubrey-law-app` without explicit approval.

## Stack

- Next.js App Router, React, TypeScript
- Tailwind CSS v4, shadcn/ui, Radix UI
- Supabase Postgres/Auth (greenfield baseline + lite migrations)
- Cloudflare R2 private document storage
- Node estate document generator (data in `tools/aubreylaw-docgeneration`)
- Optional: Resend (alerts), Telnyx or Twilio (SMS/voice), Microsoft Graph (Outlook send), Retell (AI receptionist)

## Local setup

Use Node.js 22 and npm.

```bash
npm ci
cp .env.local.save .env.local   # if you have a saved env file
# Start local Supabase (Docker), then:
# sg docker -c "SUPABASE_AUTH_SITE_URL=http://localhost:3002 ./node_modules/.bin/supabase start"
npm run dev
```

Dev server: [http://localhost:3002](http://localhost:3002)

## Main routes

### Staff (`attorney` / `admin`)

| Route | Purpose |
|-------|---------|
| `/admin/matters` | Create and manage matters |
| `/admin/matters/[id]` | Overview, documents, contacts, communications |
| `/admin/drafting` | Drafting hub (kanban / table) |
| `/admin/drafting/[matterId]` | Design → Generate → Review workspace |
| `/admin/pipeline/aging` | Matter-only SLA aging dashboard |
| `/admin/calls` | Unassigned call triage |
| `/admin/settings` | Models, API keys, Outlook, Stage SLA |

### Client portal

| Route | Purpose |
|-------|---------|
| `/intake` | Full guided intake questionnaire (parity with aubrey-law-app) |
| `/documents` | Shared PDFs + client uploads |
| `/messages` | Matter messaging with the firm |
| `/dashboard` | Thin portal home |

### Auth

- `/auth/login` — staff and clients (role-based redirect)
- Staff OAuth still requires `@aubreylegal.com`

## Drafting policy

Cornerstone drafting is **off-limits** for ports from `aubrey-law-app` unless you explicitly approve an exception:

- Design sheet UI/state (`app/admin/drafting/[matterId]/design`, `lib/designSheet/*`)
- Generate / review steps and draft APIs
- `lib/draftPayload/*`, `lib/estateGenerator/*`

Allowed integration points only:

- Matter detail → **Open drafting**
- Intake submit → `ensureDesignSheetSeededFromIntake` / `seedFromIntake` (Cornerstone)
- Matter create → `ensureDesignSheetSeededFromIntake`
- Stage changes → existing `PATCH /api/admin/matters/[id]/stage`

## Database

The timestamped files in `supabase/migrations/` are the canonical schema history. Do not
copy old quick-fix SQL into the dashboard or edit an applied migration.

```bash
# Local only: destroys and rebuilds the local database
sg docker -c "SUPABASE_AUTH_SITE_URL=http://localhost:3002 ./node_modules/.bin/supabase db reset"

# Linked shared database: inspect before applying anything
npx supabase migration list --linked
npx supabase db push --dry-run
```

Never run `supabase db reset --linked` against the shared firm database. See
[supabase/migrations/README.md](supabase/migrations/README.md) for the reconciliation and
deployment workflow.

## Verification

```bash
npm run typecheck
npm test
npm run build:next
```

## Environment

See [VERCEL_ENV_CHECKLIST.md](VERCEL_ENV_CHECKLIST.md) for Supabase, R2, Resend, Telnyx/Twilio, Microsoft Graph, and Retell variables.

## Sharing PDFs with clients

On the Review step: **Convert PDF** (LibreOffice worker) or **Upload PDF to share**. Word stays internal. Clients see `review` / `signed` / `final` PDFs on `/documents` and can upload to the `client` folder.
