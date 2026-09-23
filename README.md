# Cornerstone Lite

A Next.js practice app for estate-planning **intake**, **CRM**, **matters**, **communications**, **tasks**, **calendar**, **billing**, and **drafting**.

Drafting (design sheet → generate → review) lives in this repo and is the source of truth. Do **not** port drafting code from `aubrey-law-app` without explicit approval.

## Stack

- Next.js App Router, React, TypeScript
- Tailwind CSS v4, shadcn/ui, Radix UI
- Supabase Postgres/Auth (greenfield baseline + lite migrations)
- Cloudflare R2 private document storage
- Node estate document generator (data in `tools/aubreylaw-docgeneration`)
- Optional: Resend (alerts), Telnyx (staff texting; Telnyx or Twilio voice callbacks), Google (Calendar + Gmail send/triage), Retell (AI receptionist)

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

### Word add-in

`word-addin/` is a sideloaded Word task pane that drafts against the same
routes: chat and tracked-change redlines, the matter's design sheet in both
directions, version saves into R2, and the firm formatting pass. It runs beside
this dev server on `https://localhost:3100` and proxies `/api` to it. Setup,
sideloading, and troubleshooting are in
[word-addin/README.md](word-addin/README.md).

## Main routes

### Staff (`attorney` / `admin`)

| Route | Purpose |
|-------|---------|
| `/admin` | Today exception queue and daily command center |
| `/admin/texts` | Text conversations with leads, clients, contacts and unknown numbers (Telnyx) |
| `/admin/crm` | Leads, contacts, households, and follow-up |
| `/admin/matters` | Create and manage matters |
| `/admin/matters/[id]` | Overview, documents, contacts, tasks, and billing |
| `/admin/drafting` | Drafting next-action queue |
| `/admin/drafting/[matterId]` | Design → Generate → Review workspace |
| `/admin/tasks` | Unified work queue and recurring work |
| `/admin/calendar` | Cornerstone appointments and Google Calendar |
| `/admin/billing` | Charges, invoices, payments, claims, and accounting export |
| `/admin/assistant` | Firm assistant |
| `/admin/works` | Workflow and reference library |
| `/admin/settings` | Firm, models, email, Google, scheduling, and SLA settings |

### Client portal

| Route | Purpose |
|-------|---------|
| `/intake` | Full guided intake questionnaire (parity with aubrey-law-app) |
| `/documents` | Shared PDFs + client uploads |
| `/account` | All invoices, balances, payment links, and paid-invoice receipts |
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

Migrations apply themselves: merging one to `main` runs
[`db-migrate-deploy.yml`](.github/workflows/db-migrate-deploy.yml), which pushes it to the
shared firm database and verifies the history afterwards. Because the code ships on the same
push and in no guaranteed order, write migrations that are safe against the previous release.

Never run `supabase db reset --linked` against the shared firm database. See
[supabase/migrations/README.md](supabase/migrations/README.md) for the reconciliation and
deployment workflow.

## Verification

```bash
npm run typecheck
npm test
npm run build:next
npm run audit:render-matrix
```

## Billing and durable-workflow rollout

Migration `20261004000000_solo_practice_efficiency_billing.sql` is additive and does not convert historical billing. New direct-pay fee schedules, durable workflow jobs, and the probate track are separately gated by the singleton `firm_settings` flags `billing_milestones_enabled`, `durable_workflow_jobs_enabled`, and `probate_track_enabled`; all default to `false`. Enable them only after applying the migration and completing the local/staging verification in `OPERATIONS_RUNBOOK.md`.

Direct-pay estate-planning and college-preparation schedules use two due-on-receipt phase fees: 50% at completed engagement and 50% at `drafts_approved`, with any odd cent allocated to the second phase. Legal-plan claims remain carrier-facing. Probate schedules require attorney-entered opening, administration, and closing phase amounts. Advance cost deposits are not supported.

## Environment

See [VERCEL_ENV_CHECKLIST.md](VERCEL_ENV_CHECKLIST.md) for Supabase, R2, Resend, Telnyx/Twilio, Google, and Retell variables.

## Sharing PDFs with clients

On the Review step: **Convert PDF** (LibreOffice worker) or **Upload PDF to share**. Word stays internal. Clients see `review` / `signed` / `final` PDFs on `/documents` and can upload to the `client` folder.

### Verification commands

- `npm run build`: real Next production build, including theme generation.
- `npm run typecheck`: incremental TypeScript check (not a build).
- `npm run build:ci`: production build with synthetic configuration and a fixed 4 GiB Node heap for build workers; requires a clean checkout without Next environment files. Parent Node options are not forwarded.
- `npm test`: unit suite with synthetic credentials; ignores local environment files.
- `npm run test:integration`: opt-in loopback Supabase tests; see `tests/README.md`.

CI keeps the main-only deployment policy and now checks the root production build before release.
