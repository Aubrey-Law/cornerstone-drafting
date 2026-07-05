# Staging — Cornerstone Drafting

Staging validates the drafting app against fake matter data without touching production clients.

**Time estimate:** 30–45 minutes first time.

---

## Architecture

```
Production  -> Vercel Production -> Supabase prod (shared firm DB)
                                 -> R2 legal-documents

Staging     -> Vercel Preview    -> Supabase staging OR prod read-only*
                                 -> R2 legal-documents-staging
```

\* Most teams point staging at a **separate Supabase project** with seeded test matters. You can also use the shared firm database with a staging-only admin account — do not reset migrations on the shared project.

---

## Step 1 — Supabase

**Option A — Shared firm database (simplest)**

Reuse production/staging Supabase credentials. Matters must already exist from the CRM portal.

**Option B — Isolated staging project**

1. Create `cornerstone-drafting-staging` at [supabase.com/dashboard](https://supabase.com/dashboard).
2. Apply only the drafting baseline:
   ```bash
   supabase link --project-ref <staging-ref>
   supabase db push
   ```
3. Seed test matters, intake rows, and design sheets manually or via SQL.

Configure Auth:

- Site URL: `https://<staging-host>`
- Redirect URLs: `https://<staging-host>/auth/callback`

Create one admin user (`role = attorney` in `public.users`).

---

## Step 2 — Cloudflare R2 staging bucket

1. Create bucket `legal-documents-staging` (or similar).
2. Point Preview env vars at staging keys:
   - `R2_ACCOUNT_ID`
   - `R2_ACCESS_KEY_ID`
   - `R2_SECRET_ACCESS_KEY`
   - `R2_BUCKET` / `R2_BUCKET_NAME`

---

## Step 3 — Vercel Preview environment

Set Preview-scoped variables (see [VERCEL_ENV_CHECKLIST.md](VERCEL_ENV_CHECKLIST.md)):

| Variable | Notes |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Staging or shared |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Matching project |
| `SUPABASE_SERVICE_ROLE_KEY` | Matching project |
| `R2_*` | Staging bucket |
| `ANTHROPIC_API_KEY` | Optional AI import/fallback |
| `ADMIN_EMAIL` | Staging admin inbox |
| `ESTATE_GENERATOR_ENGINE` | `node` (default) |

Build command (from `vercel.json`):

```bash
npm run estate-generator:setup && npm run build:next
```

---

## Step 4 — Smoke test

1. Open `/auth/login` on the staging host.
2. Sign in as staging admin → should land on `/admin/drafting`.
3. Open a seeded matter → design → generate → review.
4. Confirm `/api/health?check=full` returns `{ ok: true }`.

---

## Quarterly maintenance

- Rotate staging service-role key if compromised.
- Refresh seeded test matters after schema changes.
- Confirm Python venv still builds on Vercel if using `ESTATE_GENERATOR_ENGINE=python`.
