# Word Add-in Production Rollout Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the existing Word add-in from a hand-sideloaded development manifest pointing at `https://localhost:3100` to an add-in the firm's attorneys receive through Microsoft 365, served from Cornerstone itself.

**Architecture:** The Next app serves the pane. `word-addin/` builds to `public/addin/`, so `taskpane.html`, `dialog.html`, `commands.html` and every `/api/addin/*` call share the origin `https://cornerstone.aubreylegal.com`. This is the production shape the pane's API client already assumes ("in production the pane is served by the Next app") and it is what removes the need for CORS and keeps Word's WebView off mixed content. No second host, no separate deploy.

**Not in scope:** the `>3.5 MB` Vercel body cap, per-machine matter/document links, and diff-less write-back. All are documented limitations that survive this rollout unchanged.

---

## Facts you need before starting

Verified against the repository on 2026-09-20. Do not re-derive these.

**The add-in is built and merged.** Thirteen PRs, ending at #536. Ten gated routes under `app/api/addin/`, a task pane with chat, drafting, version save, design-sheet write-back and the formatting pass, and its own vitest suite. Nothing in this plan writes a feature.

**It is a nested npm project, deliberately isolated.** `tests/word-addin-project.test.ts` pins every strand of that isolation, and each exclusion was needed for a different reason:

| isolation | where |
| --- | --- |
| not a workspace | root `package.json` `workspaces` is an explicit list |
| excluded from both tsconfigs | `tsconfig.json` and `tsconfig.typecheck.json` each re-declare `exclude` |
| ignored by eslint | `'word-addin/**'` in `eslint.config.mjs` |
| outside root vitest | root `vitest.config.ts` includes `tests/` only |
| no inherited PostCSS | inline `css: { postcss: {} }` in `word-addin/vite.config.ts` |

Keep all of it. This plan adds a **build artifact** path, not a source-tree merge.

**`word-addin/node_modules` does not exist after a root `npm ci`.** The add-in has its own `package-lock.json`. Any build or CI step must install it explicitly with `npm --prefix word-addin ci`.

**`word-addin/dist/` is gitignored.** The pane cannot be committed as a prebuilt artifact; it has to be built during the Vercel build.

**The Vercel build is `npm run build:next`, with `prebuild:next` running `theme:generate`.** That prebuild hook is where the add-in build belongs. Consequence to respect: **once the add-in build runs in `prebuild:next`, a broken add-in build fails production deploys of the whole app.** CI coverage (Task 8) must land in the same PR as, or before, Task 1.

**Nothing in CI builds or tests the add-in today.** `app-ci.yml` runs root lint, typecheck, test, build, corpus and the workbench. The add-in's `npm test` and `npm run build` have never run in CI.

**`next.config.mjs` declares no `headers()`.** There is no cache-control policy to extend — Task 2 adds the first one.

**Word's WebView caches add-in content aggressively enough to look like a bug.** The dev server sends `no-store` on everything for exactly this reason. Production needs the equivalent for the HTML entry points, or a deploy will not reach an attorney who already opened the pane.

**The canonical origin is `https://cornerstone.aubreylegal.com`** (`NEXT_PUBLIC_APP_URL`). `cornerstone-drafting.vercel.app` and `cornerstone-drafting-20.vercel.app` also resolve; the manifest must name one origin and it should be the custom domain.

**Every URL in `manifest.xml` is `https://localhost:3100`:** `SourceLocation`, `Taskpane.Url`, `Commands.Url`, `SupportUrl`, `IconUrl`, `HighResolutionIconUrl`, the three `bt:Image` entries, and the first `AppDomain`.

**`AppDomains` is not decoration.** An Office dialog may only navigate to a listed domain. The current list carries Supabase (`qifunlovuwaryzsyfbnh.supabase.co`), `login.microsoftonline.com`, `login.live.com` and `accounts.google.com` because the sign-in dialog leaves the origin and comes back. All four stay; only the localhost entry is replaced.

**The manifest deliberately omits `WordApiDesktop` and `DialogApi`.** Declaring either makes the add-in refuse to load in Word on the web entirely; both are probed at runtime. `tests/word-addin-project.test.ts` pins this. Do not add them.

**Office caches the manifest.** `<Version>` must increment on every manifest change or clients keep the old one.

---

## Decisions — settled 2026-09-20

- [x] **Production GUID: new.** The production manifest gets its own `<Id>`, so a developer's sideload and the pushed add-in can coexist on one machine. `eb710b66-9514-48ff-b60e-15b5ca4deee3` stays the development GUID.
- [x] **The first-run 403 is fixed before rollout.** Done — Task 7.
- [ ] **Who holds Microsoft 365 admin.** Still open. Centralized deployment (Task 9) needs Global Admin or Exchange Admin in the firm tenant. Nothing in Tasks 1–8 is blocked on it.

## Order of work

CI first, then the 403, then the hosting change. Tasks 8 and 7 are complete; Phase 1 is the next block of work.

---

## Phase 1 — Serve the pane from Cornerstone

### Task 1: Build the add-in into `public/addin/` during the Vercel build — DONE

- [x] Set `base: '/addin/'` in `word-addin/vite.config.ts` so emitted asset URLs are origin-absolute under the subpath.
- [x] Point `build.outDir` at `../public/addin` with `emptyOutDir: true`. Keep the three `rollupOptions.input` entries.
- [x] Add a root script: `"build:addin": "npm --prefix word-addin ci && npm --prefix word-addin run build"`.
- [x] Chain it into `prebuild:next`: `npm run theme:generate && npm run build:addin`.
- [x] Add `public/addin/` to `.gitignore` beside the existing `word-addin/dist/` entry.
- [x] Extend `tests/word-addin-project.test.ts`: the five isolation assertions stay green, plus a new one that `prebuild:next` invokes `build:addin` and that `build:addin` uses `--prefix word-addin` (not a workspace install).
- [x] Verify on a real deploy that the Vercel build finds Node ≥22 for the nested install and that the added install time is acceptable.

**Why `public/` and not a route:** Next copies `public/` into the deployment at build time and serves it statically. No handler, no bundling of Office.js into the Next graph, and the isolation above is untouched.

### Task 2: Cache headers for the pane — DONE

- [x] Add a `headers()` block to `next.config.mjs`:
  - `/addin/:path*.html` → `Cache-Control: no-store, no-cache, must-revalidate` and `Pragma: no-cache`.
  - `/addin/assets/:path*` → `public, max-age=31536000, immutable` (Vite content-hashes these).
- [x] Verify with `curl -sI https://cornerstone.aubreylegal.com/addin/taskpane.html | grep -i cache-control`.

Without this, an attorney who has opened the pane once keeps running the bundle from that day, and `npm run clear-cache` is a developer command they do not have.

### Task 3: Confirm the Supabase keys reach the production bundle — DONE, and now enforced

- [x] After the first deploy, grep the built dialog bundle for the Supabase project ref: `grep -rl "qifunlovuwaryzsyfbnh" public/addin/assets/`.
- [x] If absent, the sign-in dialog cannot authenticate. Fix by passing the values explicitly into the Vite build rather than relying on ambient pickup.

**Resolved 2026-09-20 — this is no longer a risk, only a confirmation.** The concern was that `word-addin/vite.config.ts` sets `envDir` to the repo root, which works in development because a root `.env` exists, while **on Vercel there is no `.env` file at all**. Probed directly: a Vite build with `envDir` pointed at an empty directory, `envPrefix` including `NEXT_PUBLIC_`, and `NEXT_PUBLIC_SUPABASE_URL` set only in `process.env` inlined the value into the bundle. Vite's `loadEnv` does collect prefix-matching keys from the process environment. Keep the grep as a post-deploy check, not as a blocker.


**Verified end to end, not just wired.** `npm run build:next` runs the whole chain (`theme:generate` → `build:addin` → `next build`) and exits 0. The built app was then served with `next start` and checked over HTTP:

| URL | result |
| --- | --- |
| `/addin/taskpane.html`, `/dialog.html`, `/commands.html` | 200, `no-store, no-cache, must-revalidate` |
| `/addin/static/taskpane-<hash>.js` | 200, `public, max-age=31536000, immutable` |
| `/addin/assets/icon-32.png` | 200, `public, max-age=0` — revalidates, as an unhashed file must |

**Two corrections made while building this:**

1. The first draft matched the HTML entry points with `/addin/:path*.html`. The three pages are the whole set and are enumerated in `rollupOptions.input`, so they are now named literally — a literal source cannot be defeated by a path-matching subtlety.
2. Vite copies the **unhashed** ribbon icons into the same directory as the content-hashed bundles, and one cache rule cannot be right for both — `immutable` on `icon-32.png` would mean a replaced icon never reaches anyone. `assetsDir` is now `static/` for hashed output, leaving `assets/` to the icons.

**A silent failure found and closed.** This worktree has no `.env` (it is gitignored, so a fresh worktree never gets one). The add-in build **succeeded anyway**, emitting `createClient(undefined, undefined)` — a pane that loads, renders, and fails only when an attorney tries to sign in. `word-addin/vite.config.ts` now runs `assertSignInIsPossible`: a warning for an ordinary build, and a hard failure when `VERCEL_ENV === 'production'`. Scoped that way because CI and fresh worktrees legitimately build with no environment. All three branches were exercised, including confirming that credentials supplied only through `process.env` are inlined — which is the Vercel case, proven through the real build rather than a probe.

---

## Phase 2 — A production manifest

### Task 4: Generate `manifest.prod.xml` — DONE

- [x] Add `word-addin/scripts/manifest.mjs` that reads `manifest.xml` as a template and substitutes the origin, emitting a production manifest. One source of truth beats two drifting XML files.
- [x] Substitute `https://localhost:3100` → `https://cornerstone.aubreylegal.com` in all nine URL positions, and add `/addin` to the paths: `SourceLocation` becomes `https://cornerstone.aubreylegal.com/addin/taskpane.html`.
- [x] Replace the localhost `AppDomain` with the production origin. Keep the Supabase and three identity-provider domains exactly as they are.
- [x] Use the new production `<Id>` from the open decision above.
- [x] Keep `<Requirements>` at `WordApi` 1.6 and add neither `WordApiDesktop` nor `DialogApi`.
- [x] Set `<Version>` to `1.0.0.0` and write the increment rule into the README.

### Task 5: Extend the manifest tests to the production manifest — DONE

- [x] `tests/word-addin-project.test.ts`'s `word-addin manifest` block currently reads `manifest.xml` only. Parameterize it over both manifests: task-pane type, `ReadWriteDocument`, `WordApi` 1.6, no desktop-only sets, a valid GUID.
- [x] The `lists every origin it navigates to in AppDomains` assertion matches on `https://localhost:\d+`. Generalize it to every distinct origin in the file, so the production manifest is genuinely covered rather than trivially passing.
- [x] Assert the two manifests carry **different** GUIDs.

---

## Phase 3 — Authentication against production

### Task 6: Supabase redirect URLs

- [ ] Add `https://cornerstone.aubreylegal.com/addin/**` to the Supabase project's redirect allowlist. The existing `https://localhost:3100/**` entry stays for development.
- [ ] Verify the redirect that was actually validated by reading `auth.flow_state.referrer` after one real sign-in, rather than trusting the dashboard — probe with the query string.

### Task 7: The first-run 403 — DONE

- [x] **Root cause.** `ensureUserProfile` runs on the web sign-in paths only (`app/auth/callback/route.ts`, `app/auth/login/page.tsx`, intake). The add-in's dialog talks to Supabase directly and touches none of them, so a firm attorney signing in from Word reached `requireAdmin` authenticated with no `public.users` row. `resolveUserRole` returned null and the gate answered 403. "Open the web app once first" worked because that is what ran the bootstrap.
- [x] **Fix.** The bearer branch of `verifyAdmin` in `lib/apiAuth.ts` now calls `ensureUserProfile` with the caller's own token-scoped client when the role resolves to null. `userFromBearer` became `clientFromBearer` and returns the client alongside the user, because `ensure_user_profile` is SECURITY DEFINER over `auth.uid()` and must be called as the user — the service-role client has no `auth.uid()`.
- [x] **Why it cannot self-elevate.** The RPC derives the role from the confirmed address on `auth.users`, not from anything the caller sends. A non-firm address is provisioned `client` and still fails the gate.
- [x] **Chosen deliberately over a friendlier error message.** Provisioning covers all ten `/api/addin/*` routes and every future bearer caller at once; a message would have to be written into each route and would still leave the attorney with an errand.
- [x] **One caller needed updating.** `tests/draft-generation-route.test.ts` asserts on the *source text* of `lib/apiAuth.ts` and pinned the literal `const user = await userFromBearer(token)`. The rename broke it; the assertion now pins `const { sb, user } = await clientFromBearer(token)` and carries a comment explaining the change. Note for future work in this file: both `tests/draft-generation-route.test.ts` and `tests/addin-route-auth.test.ts` assert exact code strings here, so any rename breaks them — they run without a database, which is why they are written that way.
- [x] **Test:** `tests/addin-first-run-profile.test.ts` — five cases: provisioning on first run, no self-elevation, a failed bootstrap still refused, no write once the profile exists, and an expired token still 401 with no write. Verified by reintroducing the bug: the first case fails without the fix.

---

## Phase 4 — Keep it from breaking

### Task 8: Add-in CI — DONE

- [x] A `word-addin` job added to `.github/workflows/app-ci.yml`, separate from `verify` because the install is a different lock file and there is no reason to serialise two minutes behind fourteen. Steps: `npm --prefix word-addin ci`, `npm --prefix word-addin run build` (which runs `typecheck` first), `npm --prefix word-addin test`.
- [x] `actions/setup-node` is given `cache-dependency-path: word-addin/package-lock.json` — the root `npm ci` does not install this project, so the root lock file is the wrong cache key.
- [x] Deliberately without the duplicate-run guard `verify` carries: replicating that gh-api call to save two minutes costs more in complexity than it returns. Noted in the workflow.
- [x] **Verified by running all three commands locally**, not just by reading them: install 2s, build 762ms, tests 73 passed in 1.9s. The build is confirmed headless-safe — `httpsOptions()` is gated on `command === 'serve'`, so no CA is minted.
- [ ] **Remaining:** add `word-addin` to the repository's required status checks once it has run green on a pull request.

---

## Phase 5 — Get it onto attorneys' machines

### Task 9: Centralized deployment

- [ ] Microsoft 365 admin center → Settings → Integrated apps → Upload custom apps → upload `manifest.prod.xml`.
- [ ] Assign to a group rather than the whole tenant for the first pass.
- [ ] Note the rollout lag: assignment can take up to 24 hours to appear in clients.

### Task 10: Verify on every host

- [ ] Word desktop, macOS — the primary target.
- [ ] Word desktop, Windows — never tested by the current sideload path, which is macOS-only.
- [ ] Word on the web — untested today, and centralized deployment surfaces the add-in there whether or not it was planned for. If it does not work, the manifest cannot opt out per-host; decide whether to fix or to document.
- [ ] On each: sign in, link a matter, run one chat turn with an edit card, apply the formatting pass, save a version, and run a write-back proposal.
- [ ] Re-confirm the Mac `getTrackedChanges()` under-reporting note still renders as a card note rather than a failure.

### Task 11: Document the new reality

- [ ] `word-addin/README.md` currently states "Nothing in this repo hosts it" and describes publishing as hypothetical. Rewrite that section.
- [ ] Document the manifest `<Version>` increment rule, the redeploy path, and how to remove the add-in from a user via Integrated apps.
- [ ] Keep the entire development sideload path intact and say plainly that it now coexists with the pushed add-in under a different GUID.

---


---

## Incident — 2026-09-27: the development manifest was deployed

`manifest.xml` was uploaded to Microsoft 365 → Integrated apps as-is, before Phase 1 had shipped and before a production manifest existed. Two independent faults:

1. **It points at `https://localhost:3100`.** Nothing on an attorney's machine listens there, so the ribbon button opens a pane that cannot load. No deploy of Cornerstone fixes this — the manifest itself is wrong.
2. **It carries the development `<Id>`** (`eb710b66-…`), so it collides with any developer sideload, and uploading the production manifest later will **not** replace it — different GUID, different add-in as far as Office is concerned.

Confirmed at the time: `https://cornerstone.aubreylegal.com/addin/taskpane.html` returned **404** (Phase 1 uncommitted), while `/api/addin/session` correctly returned 401. So even a correct manifest had nothing to load.

**Remediation, in order:**

- [ ] Integrated apps → select the add-in → **Remove app**. Removal reaches clients within ~24h.
- [ ] Land Phase 1 so `/addin/taskpane.html` returns 200 in production.
- [ ] Task 6 — add `https://cornerstone.aubreylegal.com/addin/**` to the Supabase redirect URLs.
- [ ] Upload `manifest.prod.xml`, assign to a small group first.

**Guards added so it cannot recur:** `tests/word-addin-project.test.ts` now fails if the production manifest contains any `localhost:\d+`, shares a GUID with the development manifest, stops matching the generator, or stops pointing at the path the build writes. All four were confirmed to fire by putting the development manifest in the production slot — the exact mistake — and all four pass with the real file.

## Verification

The rollout is done when, on a machine that has never run the repo:

1. Word shows the Cornerstone group on the Home tab without anyone sideloading anything.
2. The pane loads from `https://cornerstone.aubreylegal.com/addin/taskpane.html`.
3. Sign-in completes through the dialog and `/api/addin/session` returns a user.
4. A chat turn streams, an edit applies as a tracked change, and a version saves.
5. A subsequent deploy of Cornerstone reaches that machine's pane without clearing any cache.
