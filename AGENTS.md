# AGENTS.md

## Drafting policy

Cornerstone **drafting** (design sheet, generate, review, draft payload, estate generator) is the product center. Do **not** port or merge drafting code from `aubrey-law-app` unless the user explicitly approves an exception. New features may **link into** drafting (`/admin/drafting/[matterId]`, `ensureDesignSheetSeededFromIntake`, stage PATCH) and may **read** drafting data (`buildDraftPayload`, `listDocumentTemplates`); changes to drafting internals themselves need a good reason and careful test coverage rather than a blanket ban (owner-approved exception, July 2026 — the Mike-OSS integration consolidated the chat drafting prompts into system skills under `tools/workflows/system/`).

The assistant's drafting interview prompts (trust intake, incapacity design sheet, drafting summary) live in `tools/workflows/system/assistant/*/SKILL.md` — synced into `work_skills` (see `scripts/syncSystemWorkflows.ts`) and loaded by `lib/adminChat/prompts.ts`. Edit the SKILL.md files, not route code, to change those prompts.

## Cursor Cloud specific instructions

This is **Cornerstone Lite** — a Next.js (App Router) estate-planning app (intake, matters, portal, aging, communications, and drafting).
Standard scripts and env-var lists live in `README.md`, `OPERATIONS_RUNBOOK.md`, and
`VERCEL_ENV_CHECKLIST.md`; this section only captures the non-obvious pieces needed to
run and test it inside a Cursor Cloud VM.

### Services

| Service | Required? | How to run | Notes |
|---|---|---|---|
| Next.js dev server | yes | `npm run dev` → http://localhost:3002 | Uses `next dev --webpack`. Reads `.env.local`. |
| Supabase (Postgres + Auth + Storage + Studio) | yes | local stack via `supabase start` (needs Docker) | Auth + all matter/design/document data. |
| Cloudflare R2 | optional locally | external service (no local emulator) | Only needed for document save/upload/preview and `/api/health?check=full`. Design editing + draft **download-ZIP** work without it. |

### One-time environment prerequisites (not in the update script)

The update script only runs `npm ci`. The following are **system deps / service startup**
that a fresh VM needs and must be done manually (kept out of the update script on purpose):

1. **Docker** (for the local Supabase stack) is not preinstalled. Install `docker-ce`
   + plugins, then configure it for this VM kernel: set `storage-driver: fuse-overlayfs`
   in `/etc/docker/daemon.json` and switch to `iptables-legacy` (`update-alternatives`).
   Start the daemon with `sudo dockerd` (run it in a background tmux session). The
   `ubuntu` user is in the `docker` group, but new shells may not pick that up — prefix
   docker/supabase commands with `sg docker -c "..."` if you hit socket permission errors.

### Bringing up the local stack

1. Start Docker (see above), then start Supabase (the CLI ships as a dev dependency):
   ```bash
   sg docker -c "SUPABASE_AUTH_SITE_URL=http://localhost:3002 ./node_modules/.bin/supabase start"
   ```
   `config.toml` interpolates `SUPABASE_AUTH_SITE_URL`, so it must be set in the start env.
   `supabase/seed.sql` auto-applies on first start / `supabase db reset` — see below.
2. Write `.env.local` from the printed local credentials (`./node_modules/.bin/supabase status -o env`):
   `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_AUTH_SITE_URL=http://localhost:3002`. R2
   vars can be placeholders locally. `.env.local` is git-ignored; the required shape is
   in `VERCEL_ENV_CHECKLIST.md` (note the code reads `R2_BUCKET_NAME`, not `R2_BUCKET`).
3. Seed a staff user + a matter (Supabase auth has no UI signup for staff here):
   ```bash
   # create the auth user (email/password) via the GoTrue admin API using the service-role key
   curl -s -X POST "http://127.0.0.1:54321/auth/v1/admin/users" \
     -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
     -H "Content-Type: application/json" \
     -d '{"email":"attorney@example.com","password":"Password123!","email_confirm":true}'
   # then insert a public.users row (role='attorney') for that auth id, plus a
   # client_intake + matters (+ matter_details) row so it shows in the drafting hub.
   ```
   Demo login used during setup: `attorney@example.com` / `Password123!`.
4. `npm run dev` and open http://localhost:3002 (redirects to `/admin/drafting`; unauthenticated
   requests go to `/auth/login`).

### Non-obvious gotchas

- **`supabase/seed.sql` is mandatory for local dev** (added during setup). It (a) GRANTs
  table privileges to `anon`/`authenticated` — the local stack's default privileges omit
  `SELECT`, which otherwise makes the `users`-role lookup in `proxy.ts` return null and
  causes an infinite `/auth/login ↔ /admin/drafting` redirect loop (`ERR_TOO_MANY_REDIRECTS`);
  and (b) adds columns the trimmed drafting-baseline migrations omit but the app code needs
  (`contacts.is_minor`, `design_sheets.client_pronouns`, `design_sheets.spouse_pronouns`).
  The hosted firm DB already has these; local greenfield does not.
- After any manual `ALTER TABLE`, run `NOTIFY pgrst, 'reload schema';` or PostgREST keeps
  serving the stale schema and reports "column ... does not exist".
- The custom `custom_access_token` JWT hook is **not** enabled in local `config.toml`, so the
  `user_role` JWT claim is empty locally. This is fine — `proxy.ts` and `getCachedUserRole`
  fall back to a `users` table query (which needs the grants above).
- The design-sheet workspace re-applies computed defaults (trust names, citizenship, domicile)
  on every load and bumps `updated_at`; on a brand-new sheet this can trigger a one-time
  "design sheet was updated elsewhere" save conflict that auto-reloads. Once those defaults
  are persisted, saves are clean.
- Auth supports **attorney/admin** and **client** roles. Staff OAuth still enforces an
  `@aubreylegal.com` domain gate. Clients use email/password (or OAuth without firm domain).
  Post-login: staff → `/admin/drafting` (or safe admin redirect); clients → `/dashboard`
  (or safe portal redirect: `/intake`, `/documents`, `/messages`).
- Greenfield lite migrations (`20260710*`–`20260712*`) add intake columns, messages, aging,
  SMS/calls/calendar_connections. Run `supabase db reset` locally after pulling.

### Pre-existing check failures (not environment issues)

These fail on a clean checkout before any change; treat them as baseline, not regressions:
- `npm run lint` — 5 errors (e.g. `prefer-const` in `lib/llm/providers/*`) + warnings.
- `npm run typecheck` — type errors confined to `tests/*.test.ts`.
- `npm test` — 3 failing tests (`design-sheet-readiness`, `design-sheet-spouse-fiduciaries`,
  `draft-payload-children`); 394 pass.
