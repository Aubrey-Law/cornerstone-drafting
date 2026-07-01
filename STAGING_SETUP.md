# Staging Environment Setup

End-to-end procedure for a Vercel Preview/Staging environment that mirrors production without touching real client data, real client emails, or real DocuSeal envelopes.

**Time estimate:** 45-60 minutes the first time. Quarterly maintenance: 15 minutes.

**Cost:** Usually $0-$5/mo for the extra Supabase/R2 staging resources, depending on usage.

---

## Architecture target

```
Production domain(s)  -> Vercel Production -> Supabase prod
                                           -> R2 legal-documents
                                           -> Resend prod domain
                                           -> DocuSeal prod workspace

Staging domain        -> Vercel Preview    -> Supabase staging
                                           -> R2 legal-documents-staging
                                           -> EMAILS_ENABLED=false
                                           -> DocuSeal test workspace
```

Two principles:

1. **Staging cannot reach real clients.** `EMAILS_ENABLED=false` is the hard guard; an allowlist is the belt-and-suspenders.
2. **Staging data is disposable.** Never restore production into staging without sanitizing PII first. Empty staging plus manual seed data is safer.

---

## Step 1 — Supabase staging project

1. Create a new project at [supabase.com/dashboard](https://supabase.com/dashboard). Name it `aubrey-law-staging`.
2. Copy the project credentials for Vercel Preview environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
3. Apply migrations from a local checkout:
   ```bash
   supabase link --project-ref <staging-project-ref>
   supabase db push
   ```
4. Configure Supabase Auth:
   - Site URL: your staging host, such as `https://staging.aubreylegal.com`
   - Confirm email: ON
   - Redirect URLs: include the staging auth callback URLs
5. Seed one staging admin and a few fake clients. Use `scott+staging@aubreylegal.com` or another staging-only inbox.

---

## Step 2 — Cloudflare R2 staging bucket

1. Create a bucket named `legal-documents-staging`.
2. Turn Object Versioning ON.
3. Set CORS to the staging host and local dev host only.
4. Create or reuse a scoped R2 token and copy:
   - `R2_ACCESS_KEY_ID`
   - `R2_SECRET_ACCESS_KEY`
   - `R2_ACCOUNT_ID`

Keep staging and production bucket names distinct.

---

## Step 3 — Vercel preview/staging deployment

Use one of these patterns:

- **Preview deployments:** every branch/PR gets a Vercel preview URL. Best for ordinary QA.
- **Dedicated staging branch:** configure a stable staging domain, such as `staging.aubreylegal.com`, against a staging branch or promoted preview deployment.

For a dedicated staging domain, add the domain in Vercel, then add the DNS record Vercel provides.

---

## Step 4 — Vercel environment variables

Open Vercel Project Settings -> Environment Variables. Add staging-safe values for Preview, and Production values only for Production.

Minimum staging values:

```bash
NODE_ENV=production
NEXT_PUBLIC_SENTRY_ENVIRONMENT=staging

NEXT_PUBLIC_APP_HOST=staging.aubreylegal.com
NEXT_PUBLIC_PORTAL_HOST=staging.aubreylegal.com
NEXT_PUBLIC_APP_URL=https://staging.aubreylegal.com
NEXT_PUBLIC_PORTAL_URL=https://staging.aubreylegal.com
NEXT_PUBLIC_SITE_URL=https://staging.aubreylegal.com
PORTAL_ENABLED=true

NEXT_PUBLIC_SUPABASE_URL=https://<staging-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<staging anon key>
SUPABASE_SERVICE_ROLE_KEY=<staging service role key>

R2_ACCOUNT_ID=<cloudflare account id>
R2_ACCESS_KEY_ID=<staging access key>
R2_SECRET_ACCESS_KEY=<staging secret>
R2_BUCKET_NAME=legal-documents-staging

EMAILS_ENABLED=false
EMAIL_ALLOWLIST=aubreylegal.com,example.com
EMAIL_TEST_INBOX=scott+staging@aubreylegal.com
RESEND_API_KEY=<resend key>
RESEND_FROM=Scott Aubrey, Esq. <scott+staging@aubreylegal.com>

DOCUSEAL_API_KEY=<docuseal test workspace key>
ANTHROPIC_API_KEY=<anthropic key>
ADMIN_EMAIL=scott+staging@aubreylegal.com
CRON_SECRET=<staging cron secret>
NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=<stable random key>
```

Calendar, Lawmatics, Sentry, Google Places, and other optional integrations should also use staging-specific callback URLs where possible.

---

## Step 5 — Cron behavior

`vercel.json` configures `/api/cron/intake-sync`. Keep `CRON_SECRET` set in any environment where you manually test the cron route.

If staging should not run sync automatically, leave staging Lawmatics credentials unset and test the route manually with fake data.

---

## Step 6 — Verify

1. Health check:
   ```bash
   curl https://staging.aubreylegal.com/api/health
   ```
2. Admin login at `/auth/login?type=admin` with the staging admin.
3. Create a fake lead and run intake.
4. Draft an engagement agreement.
5. Attempt a send and confirm it is suppressed because `EMAILS_ENABLED=false`.
6. Upload a document and confirm it lands in `legal-documents-staging`.
7. View/download the document and confirm an audit row is written.
8. Confirm production data does not appear anywhere in the staging UI.

---

## Step 7 — Ongoing maintenance

- Re-run this setup quarterly.
- Rotate staging service-role keys after any contractor/vendor access changes.
- Keep staging OAuth redirect URLs in sync with the chosen staging domain.
- Treat any accidental `EMAILS_ENABLED=true` staging deploy as an incident until the email log proves no real recipients were contacted.
