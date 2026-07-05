# Cornerstone Drafting

A focused Next.js app for estate-planning document drafting: design sheet, document generation, and internal draft review.

This repo was extracted from the Aubrey Law portal. It keeps the drafting hub and workspace only — no client portal, leads CRM, calendar, email, or third-party integrations.

## Stack

- Next.js App Router, React, TypeScript
- Tailwind CSS v4, shadcn/ui, Radix UI
- Supabase Postgres/Auth
- Cloudflare R2 private document storage
- Node + Python estate document generator (`tools/aubreylaw-docgeneration`)

## Local setup

Use Node.js 22 and npm.

```bash
npm ci
cp .env.local.save .env.local   # if you have a saved env file
npm run estate-generator:setup
npm run dev
```

Dev server: [http://localhost:3002](http://localhost:3002)

Health check:

```bash
curl http://localhost:3002/api/health
```

## Verification

```bash
npm run typecheck
npm test
npm run build:next
```

`npm test` uses the hosted Supabase project when credentials are present in `.env.local` or `.env.test`.

## Main routes

- Drafting hub: `/admin/drafting`
- Drafting workspace: `/admin/drafting/[matterId]` (design → generate → review)
- Design sheet UI: `/admin/drafting/[matterId]/design` (section overview; each section has its own page at `/design/[sectionId]`)
- Legacy `/admin/matters/[id]/design` redirects to the design overview
- Staff login: `/auth/login`
- Draft generation API: `/api/admin/matters/[id]/draft`
- Design sheet API: `/api/admin/matters/[id]/design-sheet`

## Deployment

Deploy through Vercel. Required environment variables are listed in [VERCEL_ENV_CHECKLIST.md](VERCEL_ENV_CHECKLIST.md).

Build command (see `vercel.json`):

```bash
npm run estate-generator:setup && npm run build:next
```

## Data dependencies

Drafting reads existing matter data from Supabase (`v_matter_pipeline`, `design_sheets`, `matter_documents`, `contacts`, `client_intake`). Matters are expected to exist in the database; this app does not include matter CRM UI.

The bundled Supabase migrations were replaced with a **drafting-only baseline** (3 files in `supabase/migrations/`). The full CRM portal history is archived in `supabase/migrations_archive/portal/`.

- **Greenfield / local `supabase db reset`**: applies the drafting baseline only.
- **Existing firm database**: keep the current schema; deploy app code only — do not reset migrations.

See [supabase/migrations/README.md](supabase/migrations/README.md).

## Sharing PDFs with clients

Export PDFs from Word locally, then use **Upload PDF to share** on the Review step. Automated DOCX→PDF conversion (Microsoft Graph) is not included in this app.
