# Operations Runbook

Operator-facing procedures for Aubrey Law portal. Not a how-the-code-works document — read this when something is on fire or before something can be.

---

## Part 1 — Data durability checklist

Confirm each of these is live before treating the app as production. Re-verify quarterly.

### Supabase

| Check | Where | Pass criteria |
|---|---|---|
| **PITR enabled** | Project Settings → Add-ons → Point-in-Time Recovery | 7-day retention minimum. PITR is an add-on; the free daily backup is not a substitute (it's a single point per day with no restore-to-time). |
| **Backup restore tested** | Project Settings → Database → Backups → "Restore" (use a scratch project) | Restore the latest snapshot into a scratch project. Confirm `matters`, `matter_documents`, `document_access_audit`, `engagement_agreements`, `email_log` are all present and non-empty. Tear down the scratch project. |
| **Service-role key rotation plan** | Project Settings → API | Document the rotation procedure. Required env updates: Vercel (`SUPABASE_SERVICE_ROLE_KEY`), local `.env.local`, any CI secrets. |
| **Auth email confirmation required** | Project Settings → Authentication → Email | "Confirm email" is ON. Several authorization paths trust `email_confirmed_at`. |

### Cloudflare R2

| Check | Where | Pass criteria |
|---|---|---|
| **Object versioning enabled** | R2 → bucket → Settings → Object Versioning | Enabled. Without it, a buggy DELETE or overwrite is unrecoverable. The `DELETE /api/documents/[id]` route deletes from R2 on success; versioning gives you a window to restore. |
| **Lifecycle rule for non-current versions** | R2 → bucket → Settings → Object Lifecycle | Expire non-current versions after 90 days (matches the email log retention). Keeps storage bounded. |
| **Bucket is private** | R2 → bucket → Settings → Public access | Public access disabled. All access goes through presigned URLs only. |
| **CORS allowlist** | R2 → bucket → Settings → CORS | Only the production hosts (`NEXT_PUBLIC_APP_HOST`, `NEXT_PUBLIC_PORTAL_HOST`) and `localhost:3000` for dev. No wildcards. |
| **API token scope** | Cloudflare dashboard → R2 → Manage API tokens | The token used in `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` is scoped to this single bucket, not account-wide. |

### Vercel (host)

| Check | Where | Pass criteria |
|---|---|---|
| **Environment isolation** | Vercel Project Settings → Environment Variables | Production, Preview, and Development use separate env-var values where data or recipients differ. No shared service-role key between production and staging. |
| **Secrets in Vercel only** | Vercel Project Settings → Environment Variables | No secret values committed to the repo. `.env.example` and `.env.local.example` show *shape* only. |
| **Healthcheck wired** | Vercel deployment plus synthetic monitor | `/api/health` returns 200. |

---

## Part 2 — Break-glass procedures

Run these without thinking too hard. Each one starts with "stop the bleeding," not "understand the root cause."

### Scenario A — Admin account locked out

**Symptom:** Scott cannot sign in to `/auth/login?type=admin`. The portal still serves clients; nothing else is broken.

1. **Pull up Supabase Studio.** Project → Authentication → Users.
2. **Find the admin user** by email (`scott@aubreylegal.com` by default; check `ADMIN_EMAIL` env var).
3. **Send a magic link.** Click the user → "Send magic link". Open the email, click through, you're in.
4. **If the user row is missing** in `public.users` (auth row exists but no profile), insert one manually:
   ```sql
   insert into public.users (id, email, role)
   values ('<auth-user-id>', 'scott@aubreylegal.com', 'attorney')
   on conflict (id) do update set role = excluded.role;
   ```
5. **If MFA was the blocker:** Studio → Authentication → Users → user → "Reset MFA factors". Then sign in fresh.

**Do not:** create a second admin account by SQL with a new UUID. That orphans every row keyed by the original `user_id`.

### Scenario B — Client reports "I see someone else's documents"

**Symptom:** A client emails or messages saying they can see documents/matters that aren't theirs. Treat as confirmed until disproven.

**First 5 minutes — stop the bleeding:**

1. **Disable the portal.** Set `PORTAL_ENABLED=false` in Vercel production environment variables and redeploy. The proxy will 404 every portal path. Admin/firm access continues to work.
2. **Note the reporting client's email + a screenshot if they provided one.** Don't ask follow-up questions yet — you have data to verify with.

**Next 30 minutes — establish facts:**

3. **Pull the audit trail in Supabase Studio:**
   ```sql
   select created_at, action, user_email, document_id, matter_id, metadata
   from document_access_audit
   where user_email = '<reporting client email>'
   order by created_at desc
   limit 100;
   ```
4. **Cross-check which matters that user actually owns:**
   ```sql
   select m.id, m.client_id, m.name, u.email
   from matters m
   left join auth.users u on u.id = m.client_id
   where u.email = '<reporting client email>'
      or m.id in (select matter_id from client_intake where user_id = (
        select id from auth.users where email = '<reporting client email>'
      ));
   ```
5. **If the audit shows reads on matters the user doesn't own:** confirmed incident. Continue to "Recovery."
6. **If the audit shows only owned matters:** likely a UI bug (mis-rendered name/label). Re-enable portal after confirming.

**Recovery (only if step 5 confirmed):**

7. **Identify the scope.** Pull all audit rows where `user_email` is the reporting client but `matter_id` doesn't belong to them. That's your exposure list.
8. **Rotate session secrets.** Supabase project → JWT Secret → rotate. This invalidates every existing session.
9. **Rotate the service-role key.** Same project → API → rotate.
10. **Notify affected clients** in writing within 60 days per MA 201 CMR 17 (most likely also within shorter windows per ABA Model Rule 1.6 comments). Loop in malpractice carrier *before* notification.
11. **Preserve evidence.** `pg_dump` the `document_access_audit` table to S3 and snapshot Sentry for the relevant time range before anything rotates.
12. **Re-enable portal** only after the root-cause fix is deployed.

### Scenario C — Service-role key compromised

**Symptom:** Key leaked in a screenshot, a Slack message, a public commit, or by a former contractor.

1. **Rotate the key now.** Supabase project → API → "Generate new service_role key". Old key invalidates immediately.
2. **Update Vercel env:** `SUPABASE_SERVICE_ROLE_KEY`. Redeploy production so the new deployment picks up the rotated value.
3. **Update local `.env.local`** and any CI secrets.
4. **Pull audit trail for the exposure window:**
   ```sql
   select created_at, action, user_email, matter_id, count(*)
   from document_access_audit
   where created_at > '<leak time>'
   group by 1, 2, 3, 4
   order by 1 desc;
   ```
5. **Pull email_log for the same window** — anything sent from the compromised period.
6. **Check Resend dashboard** for unusual send patterns.
7. **If the key was public for more than a few minutes:** treat as Scenario B and notify clients.

### Scenario D — Email kill switch panic

**Symptom:** Emails are firing that shouldn't be (test data going to real clients, or sensitive data redirected to the wrong inbox).

1. **Hard kill immediately.** Vercel env: `EMAILS_ENABLED=false`. Redeploy. All categories suppressed regardless of admin settings.
2. **Pull recent sends:**
   ```sql
   select sent_at, category, intended_to, actual_to, status, subject
   from email_log
   where sent_at > now() - interval '1 hour'
   order by sent_at desc;
   ```
3. **For accidental sends to real recipients:** send a correction email *manually* (not through the app). Document in `email_log` by hand if needed.
4. **Re-enable after root cause fix:** unset `EMAILS_ENABLED` or set to `true`.

### Scenario E — Engagement double-send (post-#6 fix)

**Symptom:** Client received two DocuSeal envelopes for one engagement.

1. **Check `engagement_agreements` status.** Should be `sent` or `signed`. If `sending`, the row is stuck — see step 3.
2. **Check `lead_activity`** for `type='agreement_sent'` rows on the same `agreement_id`. There should be one. Multiple means the idempotency gate failed somehow.
3. **If status is stuck at `sending`:** manually revert to `draft`:
   ```sql
   update engagement_agreements set status = 'draft'
   where id = '<agreement-id>' and status = 'sending';
   ```
4. **In DocuSeal dashboard:** void any duplicate envelope before the client signs it.
5. **Notify the client by phone**, not email — a duplicate envelope can read as a phishing attempt and erode trust.

### Scenario F — Document storage full / R2 quota exceeded

**Symptom:** Uploads start failing with 5xx; signed-URL PUTs return quota errors.

1. **Check R2 dashboard** for current usage.
2. **Identify large unused objects.** R2 keeps non-current versions if versioning is on; lifecycle should be expiring them but verify the rule is active.
3. **Tactical mitigation:** raise the R2 plan tier (paid → next tier is instant, no migration).
4. **Strategic:** look for stuck `matters/*/drafts/*` objects with no corresponding `matter_documents` row (orphaned by the DELETE → DB → R2 ordering). These can be GC'd safely:
   ```sql
   -- Build the list of valid keys
   select distinct r2_key from matter_documents;
   ```
   Anything in R2 not in that list and older than 7 days is safe to delete.

---

## Part 3 — On-call posture

You are the only on-call engineer. Set expectations accordingly:

- **Sentry alerts** go to email + (recommended) a phone push via the Sentry mobile app.
- **Vercel deployment health** check at least daily for the first 90 days. After that, hook a synthetic monitor (Pingdom, Better Stack, etc.) to `/api/health`.
- **Supabase status** is unrelated to your app — bookmark `status.supabase.com`.
- **Cloudflare status** — bookmark `cloudflarestatus.com`.

For an outage: post a single status update at a known URL (Notion page, status.aubreylegal.com if you ever set one up) and link clients to it from any out-of-band channel. Do not try to email them when email is what's broken.
