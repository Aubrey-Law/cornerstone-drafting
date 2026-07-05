# Cornerstone Drafting — Operations Runbook

Operator procedures for the internal drafting app. Read this when something breaks or before go-live checks.

---

## Part 1 — Data durability checklist

Re-verify quarterly.

### Supabase

| Check | Where | Pass criteria |
|---|---|---|
| **PITR enabled** | Project Settings → Add-ons | 7-day retention minimum on production. |
| **Backup restore tested** | Database → Backups | Restore into a scratch project; confirm `matters`, `design_sheets`, `matter_documents`, `document_access_audit` exist. |
| **Service-role rotation plan** | Project Settings → API | Document rotation for `SUPABASE_SERVICE_ROLE_KEY` in Vercel + local `.env.local`. |
| **Email confirmation** | Authentication → Email | Confirm email ON for staff accounts. |

### Cloudflare R2

| Check | Where | Pass criteria |
|---|---|---|
| **Object versioning** | Bucket → Settings | Enabled — protects against accidental deletes from document routes. |
| **Bucket private** | Settings → Public access | Disabled; access via presigned URLs only. |
| **CORS allowlist** | Settings → CORS | Production/staging hosts + `localhost:3002` for dev. |
| **Token scope** | API tokens | Scoped to the documents bucket only. |

### Vercel

| Check | Where | Pass criteria |
|---|---|---|
| **Environment isolation** | Environment Variables | Production vs Preview use different R2/keys where data differs. |
| **Secrets not in repo** | — | `.env.local` git-ignored; shape documented in `VERCEL_ENV_CHECKLIST.md`. |
| **Healthcheck** | Deployment / synthetic monitor | `GET /api/health` → 200; `?check=full` probes Supabase + R2. |

---

## Part 2 — Break-glass procedures

### Scenario A — Admin locked out of drafting

**Symptom:** Cannot sign in at `/auth/login`.

1. Supabase Studio → Authentication → Users → find admin email.
2. Send magic link or reset password.
3. If `public.users` row missing:
   ```sql
   insert into public.users (id, email, role)
   values ('<auth-user-id>', 'scott@aubreylegal.com', 'attorney')
   on conflict (id) do update set role = excluded.role;
   ```
4. Post-login destination is `/admin/drafting`.

**Do not** create a second admin UUID — it orphans audit rows keyed by `user_id`.

---

### Scenario B — Draft generation fails for all matters

**Symptom:** Generate step returns 500 or empty file list.

1. Check Vercel logs for `[draft]` / `[estate-generator]` errors.
2. Verify env:
   - `R2_*` credentials and bucket name
   - `ESTATE_GENERATOR_ENGINE` (default `node`)
3. On Vercel, confirm `npm run estate-generator:setup` succeeded in build logs (Python venv only needed for `python` engine).
4. Test health: `curl -s "$HOST/api/health?check=full" | jq .`
5. Fallback: set `ESTATE_GENERATOR_ENGINE=supabase` if Node packages fail but Storage templates exist.

---

### Scenario C — Documents missing after upload

**Symptom:** Upload succeeds in UI but file 404 on download.

1. Confirm row in `matter_documents` (Supabase Studio).
2. Confirm `r2_key` object exists in R2 console.
3. Check `document_access_audit` for recent errors.
4. If R2 object missing but DB row exists — re-upload; consider versioning restore.

---

## Part 3 — Deployment

1. Merge to main → Vercel production deploy.
2. Build runs Python venv setup + Next build (see `vercel.json`).
3. No migration reset on shared firm database — app-only deploys are normal.
4. After deploy: `/api/health?check=full` and sign-in smoke test.

---

## Part 4 — Local development

```bash
npm ci
npm run estate-generator:setup   # once, for Node/Python generators
cp .env.local.save .env.local  # if available
npm run dev                    # http://localhost:3002
```

Run verification:

```bash
npm run typecheck
npm test
```

For local Supabase with the drafting baseline only:

```bash
supabase start
supabase db reset
# seed test matters before using the hub
```
