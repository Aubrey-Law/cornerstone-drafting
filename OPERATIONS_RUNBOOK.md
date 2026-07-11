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

#### OAuth (Google / Microsoft) shows 404 or bounces back to login

1. Run `node scripts/validateOAuth.mjs https://cornerstone.aubreylegal.com` (or your host).
2. **Microsoft 404** — Supabase is generating a broken authorize URL like  
   `https://<ref>.supabase.co/auth/v1/callback/oauth2/v2.0/authorize`.  
   Fix: Supabase Dashboard → Authentication → Providers → **Azure** → set **Azure Tenant URL** to  
   `https://login.microsoftonline.com/common` (or your org tenant).  
   Do **not** put the Supabase `/auth/v1/callback` URL in the tenant field.
3. **Google returns to login with `auth_failed`** — confirm Google Cloud OAuth client lists  
   `https://<ref>.supabase.co/auth/v1/callback` as an authorized redirect URI.
4. Confirm Supabase **Redirect URLs** include `https://<your-host>/auth/callback` for every deployment host.
5. Account must be `role IN ('attorney','admin')` in `public.users` with an `@aubreylegal.com` email.

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

---

## Part 5 — Twilio softphone (browser Voice + call logging)

Cornerstone uses the same Twilio browser softphone stack as the full portal. Configuration is **env-only** (no Settings UI).

### Environment variables

See [`VERCEL_ENV_CHECKLIST.md`](VERCEL_ENV_CHECKLIST.md) — required for Voice:

| Variable | Purpose |
|---|---|
| `TWILIO_ACCOUNT_SID` | Account |
| `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` | Browser Voice SDK JWT |
| `TWILIO_TWIML_APP_SID` | Outbound softphone TwiML App |
| `TWILIO_CALLER_ID` | Outbound caller ID |
| `TWILIO_AUTH_TOKEN` | Webhook signature verification |
| `TWILIO_INBOUND_CLIENT_IDENTITIES` | Comma-separated Supabase staff user UUIDs to ring on inbound |
| `TWILIO_INBOUND_FALLBACK_URL` | Optional Retell/Smith.ai fallthrough when no answer |
| `TWILIO_INBOUND_RING_TIMEOUT` | Seconds before fallback (default 20) |
| `NEXT_PUBLIC_APP_URL` | Public host for status callbacks |

The admin FAB is hidden when Voice env is incomplete (`isTwilioVoiceConfigured()` in `lib/twilio/config.ts`).

### Twilio Console wiring

| Resource | Voice URL |
|---|---|
| TwiML App (outbound softphone) | `https://<host>/api/voice` |
| Business line (inbound) | `https://<host>/api/voice/inbound` |
| Status callbacks (automatic via code) | `https://<host>/api/webhooks/twilio/voice-status` |
| Retell webhook (if used) | `https://<host>/api/webhooks/retell` |

Post-call alerts (`call_analyzed`): email via `RETELL_SUMMARY_TO`, SMS via `RETELL_SUMMARY_SMS_TO` (see `VERCEL_ENV_CHECKLIST.md`).

### Staff identity for inbound ring

1. Supabase Studio → Authentication → Users → copy the staff user's UUID.
2. Set `TWILIO_INBOUND_CLIENT_IDENTITIES=<uuid>` (comma-separate for multiple attorneys).
3. The same UUID is used as the Twilio Client identity in `GET /api/token` (admin JWT → `user.id`).

### Smoke test checklist

0. **Env audit (admin):** while signed in, `GET /api/admin/twilio/status` returns which Voice/SMS variables are missing (no secret values). Useful when the phone FAB is hidden or inbound does not ring.
1. Sign in as staff → confirm phone FAB appears (when Voice env complete).
2. Open FAB → token loads → dial a test number → call connects.
3. Confirm row in `calls` table and entry on `/admin/calls`.
4. Open a matter → **Calls** tab → assigned/unassigned call appears.
5. Inbound: call business line → browser rings → answer → status webhook logs call.

### Code map

- UI: `components/softphone/Softphone.tsx`, `app/admin/components/StaffSoftphone.tsx`
- Token: `app/api/token/route.ts`
- TwiML: `app/api/voice/route.ts`, `app/api/voice/inbound/route.ts`, `app/api/voice/inbound-fallback/route.ts`
- Logging: `app/api/webhooks/twilio/voice-status/route.ts`, `app/api/webhooks/retell/route.ts`

