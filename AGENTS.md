# AGENTS.md

## Drafting policy

Cornerstone **drafting** (design sheet, generate, review, draft payload, estate generator) is the product center. Do **not** port or merge drafting code from `aubrey-law-app` unless the user explicitly approves an exception. New features may **link into** drafting (`/admin/drafting/[matterId]`, `ensureDesignSheetSeededFromIntake`, stage PATCH) and may **read** drafting data (`buildDraftPayload`, `listDocumentTemplates`); changes to drafting internals themselves need a good reason and careful test coverage rather than a blanket ban (owner-approved exception, July 2026 — the Mike-OSS integration consolidated the chat drafting prompts into system skills under `tools/workflows/system/`). A second owner-approved exception (October 2026) lets `DraftingWorkspace` take `embeddedInWorkspace`: under the matter workspace header it drops its breadcrumb / "Back to matter" row and merges its steps, save status and Quick draft into one bar. Its steps and save behaviour are unchanged.

The assistant's drafting interview prompts (trust intake, incapacity design sheet, drafting summary) live in `tools/workflows/system/assistant/*/SKILL.md` and are loaded by `lib/adminChat/prompts.ts`. The bundled file is the runtime source of truth (`loadSystemSkillBody` reads it first); the `work_skills` copy exists for the Library list and the composer picker, and is synced automatically at production boot (`instrumentation.ts` → `ensureSystemWorkflowsSynced`) as well as from the Library's Sync button. Edit the SKILL.md files, not route code, to change those prompts. Attaching a workflow in the Assistant composer injects its body into the system prompt server-side (`lib/adminChat/workflowAttachment.ts`); both chat routes register tools through `lib/adminChat/toolset.ts`.

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
   in `VERCEL_ENV_CHECKLIST.md`.
3. Seed a staff user, a client portal user, a lead, and a hired matter
   (Supabase auth has no UI signup for staff here):
   ```bash
   npm run seed:browser-fixture   # scripts/seedBrowserFixture.ts — idempotent
   ```
   Logins: staff `attorney@example.com` / `Password123!`; portal client
   `client@example.com` / `Password123!`. The script prints direct URLs for the
   leads list, lead detail, matter detail, drafting hub, and portal dashboard.
4. `npm run dev` and open http://localhost:3002 (redirects to `/admin/drafting`; unauthenticated
   requests go to `/auth/login`).

### Non-obvious gotchas

- **`supabase/seed.sql` is mandatory for local dev** (added during setup). It GRANTs
  table privileges to `anon`/`authenticated` — the local stack's default privileges omit
  `SELECT`, which otherwise makes the `users`-role lookup in `proxy.ts` return null and
  causes an infinite `/auth/login ↔ /admin/drafting` redirect loop (`ERR_TOO_MANY_REDIRECTS`).
  Schema changes belong in timestamped migrations, not the seed.
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
- Run `supabase db reset` locally after pulling migrations. Never use `--linked` against the
  shared firm database.
- **"N unpushed commit(s)" after a PR merges is usually a stale ref, not lost work.** GitHub
  deletes the head branch on merge, but the local remote-tracking ref still points at the
  pre-merge SHA, so a stop hook comparing the two reports commits that are already on `main`.
  Check before acting: `git log origin/main..HEAD` — empty means there is nothing unmerged.
  Then `git remote prune origin`. Do **not** push to clear the warning: it recreates a branch
  containing only merged history, and the standing "open a PR for any pushed branch" rule
  turns that into a redundant PR. Push only when `git log origin/main..HEAD` is non-empty.

### Verification baselines

Do not rely on static failure counts here; they drift as tests and runtimes change. Run
`npm run lint`, `npm run typecheck`, and `npm test`, then distinguish existing failures from
regressions with a clean-checkout comparison when necessary.
