# Cornerstone Word Add-in

A Word task pane for drafting: chat about the open document and apply the model's
revisions as native tracked changes, drafting from the matter's design sheet and
writing decisions back to it, saving versions into Cornerstone, plus the firm
formatting pass.

Prototype status — sideloaded, firm-internal. Not published to AppSource.

## Setup

### Before you start

- **macOS.** `npm start` sideloads only here. Windows uses a trusted catalogue
  instead — see [Windows](#windows).
- **Word for Microsoft 365, kept current.** `manifest.xml` requires the
  `WordApi 1.6` requirement set, which is where individual tracked-change review
  lives. An older Word raises no error: it silently declines to offer the add-in
  at all.
- **Node 22** — the repo's `.nvmrc`; the root `package.json` allows `>=22 <26`.
- **Cornerstone running locally**, with the repository root env file in place.
  The pane proxies every request to it, and the sign-in dialog reads
  `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from that same
  file: `vite.config.ts` points Vite's `envDir` at the repository root, so the
  add-in has no env file of its own to fill in.
- **A firm account.** Every `/api/addin/*` route calls `requireAdmin`, which
  wants a `users.role` of `attorney` or `admin`. There is nothing to set up by
  hand: a first-time caller with no `public.users` row is provisioned on their
  first request, and an `@aubreylegal.com` address becomes `attorney`. The role
  comes from the confirmed address on `auth.users`, so signing in with an
  outside address is provisioned `client` and still gets a 403 on the pane's
  first call rather than at the sign-in step.
- **One Supabase setting, once per project.** **Authentication → URL
  Configuration → Redirect URLs** must include `https://localhost:3100/**`, or
  the sign-in dialog ends up on the project's Site URL instead of coming back
  with its code. See [The OAuth round trip](#the-oauth-round-trip).

### The three terminals

The first two stay running; the third is a one-shot.

```bash
# 1 — Cornerstone, from the repo root
npm ci                           # first time only
npm run dev                      # http://localhost:3002

# 2 — the pane
cd word-addin
npm install
npm run dev                      # https://localhost:3100

# 3 — register the add-in with Word
cd word-addin
npm start
```

Order matters: `npm start` does not serve anything, it only copies `manifest.xml`
into Word's sideload folder. If the pane is not already being served from
terminal 2, Word opens an empty frame.

The first `npm run dev` in `word-addin` mints a local HTTPS certificate and asks
for your keychain password; Office refuses to load a task pane over plain HTTP.
Set `DEV_HTTPS_CERT` and `DEV_HTTPS_KEY` to serve existing cert files instead,
which is the only way through in a headless environment.

### Let the terminal into Word's folder (first run, macOS)

macOS protects Word's add-in folder from other processes, so `npm start` is
refused until you grant the terminal access.

1. **System Settings → Privacy & Security → Full Disk Access** → add the terminal
   you run this from (Terminal, iTerm, VS Code…) and switch it on.
2. **Quit that terminal completely (⌘Q) and reopen it.** The permission is read
   when a process starts, so a running shell keeps the old denial. This is the
   step people skip.
3. On macOS 14 or newer, if it still fails, add it under **Privacy & Security →
   App Management** too.

Check it without involving Word:

```bash
WEF=~/Library/Containers/com.microsoft.Word/Data/Documents/wef
touch "$WEF/.permtest" && echo WRITABLE && rm "$WEF/.permtest" || echo DENIED
```

### Open it in Word

**Quit Word completely (⌘Q) and reopen it** — a running Word does not rescan the
sideload folder. Open a document and pick **Cornerstone** from the Home ribbon,
or **Insert → My Add-ins → Cornerstone**. Then **Sign in** in the pane, and link
a matter from the bar at the top.

`npm run stop` unregisters it. The sideloaded manifest is a *copy*, so re-run
`npm start` after editing `manifest.xml`.

### Verify the setup

Each command checks one layer, in the order the pane depends on them, so the
first one that disagrees is the thing to fix:

```bash
# the pane is being served, over HTTPS
curl -sk -o /dev/null -w '%{http_code}\n' https://localhost:3100/taskpane.html   # 200

# Cornerstone is up, and its add-in routes are gating
curl -s  -o /dev/null -w '%{http_code}\n' http://localhost:3002/api/addin/session # 401

# the pane's proxy reaches Cornerstone — same 401, through the HTTPS origin
curl -sk -o /dev/null -w '%{http_code}\n' https://localhost:3100/api/addin/session # 401

# Word has the manifest
ls ~/Library/Containers/com.microsoft.Word/Data/Documents/wef/                    # <GUID>.manifest.xml
```

A `401` is the healthy answer to those two: the route exists and refused an
unauthenticated call. A `404` means the proxy is pointed somewhere without
Cornerstone on it; a connection error means terminal 1 is not running.

In the pane itself, the `build <timestamp>` line under "Checking your session"
should match when you started the dev server. If it does not, Word is running a
cached bundle — see [Troubleshooting](#troubleshooting).

### Windows

`npm start` exits with instructions rather than sideloading. Word on Windows
loads add-ins from a network shared folder registered as a trusted catalogue:

1. Share a folder (it must be a UNC path — `\\machine\share`, not a local
   directory).
2. **File → Options → Trust Center → Trust Center Settings → Trusted Add-in
   Catalogs**, add the share, tick **Show in Menu**, and restart Word.
3. Copy `word-addin/manifest.xml` into the share.
4. **Insert → My Add-ins → Shared Folder → Cornerstone**.

Everything else is the same, including the two dev servers and the HTTPS
certificate. The rest of this document's paths are macOS ones.

### Environment variables

| Variable | Where it is read | What it does |
|---|---|---|
| `CORNERSTONE_ORIGIN` | `word-addin/vite.config.ts` | Where `/api` is proxied. Defaults to `http://localhost:3002` |
| `DEV_HTTPS_CERT`, `DEV_HTTPS_KEY` | `word-addin/vite.config.ts` | Serve these cert files instead of minting one. Without them `office-addin-dev-certs` installs a local CA, which needs a keychain prompt no headless environment can answer |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | repository root env file | The sign-in dialog exchanges credentials with Supabase directly. Both are public values the Next app already ships to every browser |

### Pointing the pane at a deployed Cornerstone

```bash
CORNERSTONE_ORIGIN=https://cornerstone.example npm run dev
```

The pane is still served from `https://localhost:3100` and the manifest still
points there; only the proxy target moves. If that deployment uses a different
Supabase project, two things follow: add its domain to `<AppDomains>` in
`manifest.xml` (an Office dialog may only navigate to domains listed there) and
re-sideload with `npm start`, and add `https://localhost:3100/**` to *that*
project's redirect URLs.

### How the pane is hosted

`npm run build` writes the Next app's `public/addin/` — `taskpane.html`,
`commands.html`, `dialog.html`, the content-hashed bundles under `static/`, and
the ribbon icons under `assets/`. Next copies `public/` into the deployment and
serves it, so the pane and every `/api/addin/*` call share one origin in
production exactly as the dev proxy arranges locally. Nothing about the add-in
enters the Next module graph; `tests/word-addin-project.test.ts` pins the
isolation that keeps it out of the root typecheck, lint and Next build.

From the repository root, `npm run build:addin` runs that build on its own, and
`prebuild:next` runs it before every `next build`. **A broken add-in build
therefore fails a production deploy of Cornerstone**, which is why the
`word-addin` job in `.github/workflows/app-ci.yml` gates it.

That install passes `--include=dev`, and must. Both the CI build
(`scripts/ciBuild.mjs`) and Vercel set `NODE_ENV=production`, under which npm
omits devDependencies — and every package this project builds with is one:
`vite`, `typescript`, `@types/office-js`. Without the flag the install succeeds
with 3 packages instead of 135 and fails two steps later as
`TS2688: Cannot find type definition file for 'office-js'`, which reads like a
tsconfig fault. `scripts/checkDeps.mjs` runs between the install and the build
so that gap cannot reopen silently.

`base` is `/addin/` for a build and `/` for the dev server: development serves
this project at the origin root, where the sideloaded `manifest.xml` expects it.

The manifest in this directory remains the **development** one, pointing at
`https://localhost:3100`. A production manifest points `SourceLocation`,
`Taskpane.Url`, `Commands.Url` and the icons at the deployed origin under
`/addin/`, lists that origin in `<AppDomains>`, and carries its own `<Id>` so it
can coexist with a developer's sideload.

### Deploying to the firm

Two manifests live here and they are not interchangeable:

| file | `<Id>` | points at | used for |
| --- | --- | --- | --- |
| `manifest.xml` | `eb710b66-…` | `https://localhost:3100` | sideloading on a developer machine |
| `manifest.prod.xml` | `a9e939cf-…` | `https://cornerstone.aubreylegal.com/addin` | Microsoft 365 → Integrated apps |

`manifest.prod.xml` is **generated** — `npm run manifest` rewrites it from
`manifest.xml`, and `tests/word-addin-project.test.ts` fails if the two
disagree. Edit `manifest.xml` (or `scripts/manifest.mjs`), never the generated
file.

**Never upload `manifest.xml` to Integrated apps.** It installs an add-in whose
pane is served from a localhost port that nothing on an attorney's machine is
listening on, so the ribbon button opens a pane that cannot load — and it
carries the development `<Id>`, so it also collides with any sideload. This has
happened once; the tests above now catch it.

To deploy:

1. **The pane has to exist first.** `https://cornerstone.aubreylegal.com/addin/taskpane.html`
   must return 200 — it is built by `prebuild:next`, so it appears with the first
   production deploy that includes it. Check before uploading:
   ```bash
   curl -sI https://cornerstone.aubreylegal.com/addin/taskpane.html | head -1
   ```
2. **Supabase redirect URLs** must include `https://cornerstone.aubreylegal.com/addin/**`,
   or the sign-in dialog leaves and never comes back. See
   [The OAuth round trip](#the-oauth-round-trip).
3. Microsoft 365 admin center → **Settings → Integrated apps → Upload custom
   apps**, upload `manifest.prod.xml`, and assign to a group rather than the
   whole tenant for a first pass.
4. Assignment and removal both take up to **24 hours** to reach clients.

**To remove a deployment:** Integrated apps → select the add-in → **Remove app**.
Removing by GUID matters when more than one has been uploaded: the development
and production manifests are different add-ins to Office, so uploading the
production one does **not** replace a development one already deployed.

**To ship a change:** bump `<Version>` in `scripts/manifest.mjs`
(`PRODUCTION_VERSION`), re-run `npm run manifest`, and re-upload. Office caches
the manifest and keeps serving the old one until the version increases. The
pane's own code needs no version bump — it is fetched fresh, because
`next.config.mjs` sends `no-store` for the HTML entry points.

### Why sideloading is hand-rolled

`scripts/sideload.mjs` copies the manifest into
`~/Library/Containers/com.microsoft.Word/Data/Documents/wef/` itself rather than
using `office-addin-debugging`, because that tool cannot do it on macOS. Its
`ensureLinkSync` call creates a **hard link**, and `link(2)` fails with `EPERM`
into an app container — and again if the repo sits on a synced or external
volume, since hard links cannot cross filesystems:

```
Error: EPERM: operation not permitted, link 'manifest.xml' -> '…/wef/<GUID>.manifest.xml'
```

A copy avoids both. It does **not** avoid the permission above: writing into
Word's container is protected whichever call you use, which is why granting the
terminal access is a prerequisite rather than a troubleshooting step. The
give-away is which syscall the error names — `link` is the tool's bug, `copyfile`
is the permission.

The file keeps Microsoft's `<GUID>.manifest.xml` naming so their tooling and
these scripts clean up after each other.

A copy specifically, never a symlink: the uninstall path in
`office-addin-dev-settings` resolves entries with `realpathSync` before deleting
them, so a symlink there would delete this repo's own `manifest.xml`.

Dropping that dependency also took the add-in from 438 installed packages to 91,
and from 36 reported vulnerabilities to none.

### Troubleshooting

**`EPERM ... copyfile`.** The permission grant above has not taken effect. Most
often the terminal was not quit and reopened after switching it on.

**Sideload without granting anything.** Finder is exempt from that restriction,
so a drag works where the terminal cannot:

```bash
open ~/Library/Containers/com.microsoft.Word/Data/Documents/wef
open word-addin
```

Drag `manifest.xml` across and rename it `<GUID>.manifest.xml` — the GUID is the
`<Id>` in the manifest. A plain `cp` from the terminal is **not** a workaround;
it hits the identical wall.

**The pane is running code you already changed.** Word caches add-in content
aggressively, and a cached bundle looks exactly like a bug that will not die.

The pane prints a `build <timestamp>` line while it starts. If that time does not
match when you started the dev server — or the line is missing entirely — you are
looking at a cached copy, and nothing you change will take effect.

Quit Word completely (⌘Q, not just closing the window), then:

```bash
npm run clear-cache
```

**The location is the part people get wrong.** Add-in web content lives in
Office's own web host container, `com.Microsoft.OsfWebHost` — capital M — not in
Word's container. Clearing
`~/Library/Containers/com.microsoft.Word/Data/Library/Caches` alone looks like it
worked and changes nothing. The script clears both.

Two things to confirm before blaming the cache, since each is upstream of it:

```bash
git log --oneline -1                                    # are you on the code you think?
curl -sk https://localhost:3100/taskpane.html | grep -c "Cache-Control"   # expect 1
```

A `0` from that curl means the dev server itself is serving stale HTML — restart
`npm run dev`; Word is blameless.

The dev server sends `Cache-Control: no-store` and the page carries matching meta
tags, which prevents this going forward — but a bundle cached before those landed
has to be cleared once by hand.

**Word never shows the add-in.** Confirm the manifest landed:
`ls ~/Library/Containers/com.microsoft.Word/Data/Documents/wef/`. Then quit Word
fully; ⌘W is not enough.

**Keep that folder free of anything but manifests.** Word parses every file in
it, and so does the Office tooling — a stray file makes both throw.

**Keep the repo off iCloud Drive, OneDrive, and Dropbox.** Synced paths break
Office add-in tooling in several ways beyond this one. `pwd -P` tells you where
you actually are.

**The pane loads but every request 401s.** The token expired or you signed in as
a non-staff user. Sign out and back in from the pane.

## How it reaches Cornerstone

Everything is same-origin. The Vite dev server proxies `/api`, `/auth`, and
`/_next` through to Cornerstone, so the pane never makes a cross-origin request
and **no CORS handling exists anywhere in the app**.

That is load-bearing, not incidental. Office refuses to load a task pane over
plain HTTP, and Word's WebView then blocks the resulting HTTPS page from
fetching `http://localhost:3002`. The proxy solves the mixed-content problem and
removes the need for CORS in one move.

Only `/api` is proxied. `/auth` and `/_next` used to be, so the sign-in dialog
could navigate to Next's login page; it no longer does — see below.

In production the pane should be served by the Next app itself, keeping the same
property without a proxy.

## Signing in

The pane holds a Supabase access token, not a cookie — Word blocks third-party
cookies, and the Cornerstone session cookie belongs to a different origin.

`Sign in` opens an Office dialog at `/dialog.html` — a Vite entry of this
add-in, alongside `taskpane.html`. It takes an email and password, exchanges
them with Supabase directly, confirms firm access through
`GET /api/addin/session`, and hands the token back via `messageParent`. The
token lives in `localStorage`, deliberately not in
`Office.context.document.settings`: document settings are embedded in the
`.docx`, so a token stored there would travel with the file to whoever received
it.

It offers **Continue with Microsoft** and **Continue with Google** above an
email and password form, matching `app/auth/login/page.tsx`. Most of the firm
signs in with Microsoft and has no password at all, so a password-only dialog
asks for a credential that does not exist.

The dialog reads `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
from the **repository root** `.env` — `vite.config.ts` sets `envDir` and widens
`envPrefix` to pick them up, so there is nothing to configure here. Both are
public values the Next app already ships to every browser.

### The OAuth round trip

`beginOAuth` mints a PKCE verifier, parks it in `localStorage`, and returns
`{SUPABASE_URL}/auth/v1/authorize?provider=azure&…`. The dialog navigates there;
the provider returns to Supabase's `/auth/v1/callback`, which redirects back to
`https://localhost:3100/dialog.html?code=…`. The reloaded page finds the code,
reads the verifier back out of storage, and POSTs `{auth_code, code_verifier}`
to `?grant_type=pkce`.

That is hand-rolled rather than delegated to `supabase-js`, whose auth calls
wrap everything in `navigator.locks` and an `initializePromise` — neither
bounded. The values match `@supabase/auth-js/lib/helpers.js` exactly, and a test
recomputes the challenge from first principles so the encoding cannot drift.

**Two one-time settings this repo cannot make for you:**

1. **Supabase → Authentication → URL Configuration → Redirect URLs** must include
   `https://localhost:3100/**`. Without it GoTrue ignores `redirect_to` and sends
   the browser to the project's Site URL, which lands outside the dialog.
2. Nothing on the Azure side — Microsoft still redirects to Supabase's own
   `/auth/v1/callback`, which is already registered.

`manifest.xml` lists the provider and Supabase domains under `AppDomains`: an
Office dialog may only navigate to domains declared there. Changing that file
means a re-sideload (`npm start`).

### Why it is not a Next page

It was, at `/auth/addin`, and it never once completed a sign-in. The DOM of a
stuck dialog showed office.js present only as `<link rel="preload">` — the tag
`next/script` injects *after* hydration was missing, so React had never
hydrated, no effect had ever run, and the page sat on its server-rendered first
paint forever. Four fixes were shipped against the task pane before anyone
noticed the frozen window was the dialog.

`dialog.html` has no SSR, no hydration step, no RSC and no `/_next` dependency;
office.js loads from a blocking `<script>` in `<head>`, exactly as the pane
loads it. Every step it takes has a deadline, and it shows which step it is on,
so a failure names itself instead of presenting as a hang.

If the handoff to Word fails but the sign-in succeeded, the dialog shows the
access token and the pane's signed-out view accepts it under **Paste a token
instead**.

## Server routes

All under `/api/addin/*`, all gated by `requireAdmin(req)`.

The prefix is chosen so `proxy.ts` does not match it: that middleware resolves
the session from cookies only and would reject a bearer token before any handler
ran. The cost is that these routes have no middleware backstop, so each one gates
itself — `tests/addin-route-auth.test.ts` enforces that none of them forget.

| Route | Purpose |
|---|---|
| `GET /api/addin/session` | Token check and profile |
| `POST /api/addin/chat` | SSE chat; the reply carries an `<EDITS>` block |
| `GET /api/addin/matters` | The drafting worklist, for the matter picker |
| `GET /api/addin/matters/[id]/brief` | One matter's normalized design sheet |
| `POST /api/addin/matters/[id]/design-sheet/propose` | Read the open document for decisions. Writes nothing |
| `POST /api/addin/matters/[id]/design-sheet/apply` | Write the accepted rows to the design sheet |
| `GET /api/addin/matters/[id]/documents` | The matter's Word documents, for linking the open file |
| `GET /api/addin/documents/[id]/versions` | A document's version history |
| `POST /api/addin/documents/[id]/versions` | Save the open document as the next version |
| `GET /api/addin/style-set` | The firm's active `StyleSetSettings` |
| `POST /api/addin/style-set/apply` | Style-sweep a `.docx` and return the bytes |

## Drafting from the matter

The pane drafts from the open document alone until a matter is linked. **Link a
matter** searches the same drafting worklist as `/admin/drafting` — the same
`drafting_hub_page` RPC, so it applies the same search and hides closed matters
along both of the two axes a matter can be closed on. A separate query here would
be a second answer to "what am I drafting", and the one likeliest to still offer a
matter the firm closed last week.

Once linked, every chat turn carries the matter's **design sheet**, and the model
is told it is the source of truth: where the sheet and the document disagree, the
document is out of date.

That sheet is `draftPayloadFactSheet(buildDraftPayload(matterId))` — the same
normalized payload the admin chat drafts from and the generator builds documents
from. `lib/drafting/matterBrief.ts` is a thin wrapper over those two and
deliberately does not read the design sheet itself: fiduciary slots resolve to
names, the plan type normalizes, and the design-sheet defaults apply in exactly
one place. A second reader here would be a second answer to "who is the successor
trustee", drifting from the first the moment either changed — the argument the
formatting pass already makes for round-tripping the style sweep through the
server.

**`[UNKNOWN]` is the load-bearing part.** The fact sheet marks every value the
attorney has not decided, and the prompt's non-invention rule says to leave the
document's placeholder and flag it rather than fill it in. A drafting assistant
that guesses a successor trustee produces a document that reads as finished and
names the wrong person; nothing downstream catches that. `tests/matter-brief.test.ts`
pins those instructions, and **Design sheet** in the pane shows the attorney the
same text the model gets, `[UNKNOWN]`s counted at the top — linking a matter and
finding six of them is the moment to go fill the sheet in.

The sheet is fenced with `quoteUserContent` despite being attorney-approved: it is
seeded from client intake, so its names and notes are free text a client typed.

### When the sheet does not arrive

`buildMatterBrief` never throws. A matter that is not hired, or has no design sheet
row, is an ordinary state, and losing the attorney's typed message to it would be a
poor trade — so the turn proceeds without the sheet.

It is never silent, though. The terminal SSE frame reports `matterContext`, and the
pane shows a warning on any reply where a matter is linked and the state is not
`applied`. Dropping the brief quietly is the one genuinely dangerous failure here:
the reply looks identical, and the attorney reads an invented fiduciary as a sourced
one. A reply with no `matterContext` at all — an older server — is treated as `none`
for the same reason.

`allowPartial` is deliberately not set. It would answer an unready matter with a
sheet of `[[ MISSING ]]` holes instead of an error, and a brief that looks populated
but is not is worse here than no brief.

### Where the link is stored

In `localStorage`, keyed by the document's path — not in
`Office.context.document.settings`, for the same reason the access token is not:
document settings are written into the `.docx`, so the link would travel with the
file. A token there is a credential leak; a matter id there is a quieter one — an
internal identifier for a named client, embedded in a document the firm emails to
that client and to beneficiaries.

The cost is that the link is per-machine, and an unsaved document (which has no
path, and would otherwise share one key with every other unsaved document) holds
its link in memory only.

## Version history

The add-in shipped editing whatever file was open on disk while
`/api/documents/[id]/edits` wrote R2 versions, and the two never met: an
attorney's tracked changes lived in a local file the firm's record knew nothing
about. The **Versions** tab closes that.

Link the open file to one of the matter's Word documents — chosen, never guessed
from the filename, because estate matters routinely carry a will and a trust
whose filenames differ by a word, and a wrong guess files an attorney's edits
against the wrong document in a way that only shows up much later.

**Save this version** then uploads the document as it stands and makes it the
document's next version, through `createDocumentVersion` — the same writer the
web app's edit path uses, which owns the R2 upload, the `version_number` retry
on a unique collision, and the `current_version_id` pointer.

Nothing is automatic. A version is a durable record of a legal document, and the
firm should get one because an attorney decided to make one, not because a pane
was open.

### Why the bytes, not the edit list

The pane uploads the attorney's own document rather than replaying its edit list
server-side. Replaying would produce a *different* document from the one on
their screen — Word's revisions and the server's applier do not agree at the XML
level — so the file they are looking at would stop being the file of record.

`ensureInitialVersion` runs first, so the state before the pane touched anything
becomes v1 and the save becomes v2. Without it the history would begin at the
edited document and the original would be unrecoverable.

### What stops a version being lost

The link records the version that was current when it was made, and the save
sends it back. A version created by someone else in the meantime is refused with
a 409 naming it, rather than buried — the attorney may have been editing in Word
for an hour, and silently overwriting that work is the same failure this path
exists to prevent, arriving by a different door.

It catches a version created **since the document was linked**. It cannot catch
an attorney who opened a stale download and linked that, because nothing inside a
`.docx` records which version it came from. The pane shows the version it is
about to follow for exactly that reason.

### No edit cards

Saving a version writes no `document_edits` rows, and that is deliberate.

Those rows carry each revision's `w:id` so the web UI can accept or reject one.
The pane cannot know the ids Word assigned. A row without them is worse than no
row: `resolveTrackedChange` would get an empty id list, change nothing, and still
mark the edit accepted — a review UI reporting success for a document it did not
touch.

The pane's own cards accept and reject in Word, which is where those revisions
are. Deriving real ids is possible — diff `extractTrackedChangeIds` across the
old and new bytes — but pairing them into cards with text and context needs a
tracked-change extractor that does not exist yet.

### Recorded as `word_addin`

`document_versions.source` is a CHECK-constrained text column;
`20261130000000_document_versions_word_addin_source.sql` widened it to allow
`word_addin`. The save was `user_upload` first, which was true in the letter — a
person uploaded the file they had — but read in the version history exactly like
a document dragged into the browser, and the two are not the same event.

The audit row still writes `surface: 'word-addin'` into
`document_access_audit.metadata`. That answers who made the request and from
where; the source column answers what the bytes are, which is the question the
version list asks.

`tests/document-version-source-parity.test.ts` holds `DOCUMENT_VERSION_SOURCES`
against the constraint, because a source TypeScript believes in and the database
rejects fails at insert time — after `createDocumentVersion` has already put the
bytes in R2.

The save also passes `sourceFallback: 'user_upload'`. A migration and the code
that needs it ship on the same push and finish independently, so for a minute
the new value can meet the old constraint; rather than lose the attorney's save
over a label, `createDocumentVersion` retries once under the source the previous
schema allowed and logs that it did. The retry does not re-upload — the R2 key
is timestamp-based, not version-based.

## Writing decisions back

The **Sheet** tab is the other direction: an attorney who settles a successor
trustee while redlining had to re-key it on the design sheet, or leave the two
disagreeing until someone noticed.

**Read document** sends the open document through
`parseDesignSheetImportText` — the same extraction behind the web import dialog,
which builds the proposal, compares it against the stored sheet, and marks each
row. Nothing here re-reads or re-interprets the design sheet, so the pane and the
dialog cannot disagree about what a document is proposing.

Then every change is shown, old value → new, and **only ticked rows are written**.

**Rows that would overwrite arrive unticked.** The server sets
`selected: !replacement`, and that default is the substance of the feature rather
than a nicety: filling a blank field is routine, changing a decision the attorney
already recorded is not, and the quiet version of that mistake is the one nobody
catches. Those rows are also the only ones drawn in amber.

Values the document offered that a field cannot hold are listed under **Not
applied** rather than dropped — "the document said something this field cannot
express" is a different fact from "the document said nothing", and only the first
is worth an attorney's attention. This is the same guard that kept
'per stirpes' out of `distribution_method`.

### One writer

`lib/designSheet/applyProposal.ts` is the only thing that writes an accepted
proposal. The web dialog's route and this one both call it, and
`tests/design-sheet-completion.test.ts` asserts that neither touches
`design_sheets` itself.

That module is where the compare-and-swap lives, where a created contact gets its
`matter_contacts` join row, and where an empty decisions blob is kept out of the
database. Each of those has been got wrong once already; a second writer is where
they would silently come back.

### What the pane may write

Narrower than the dialog, because the pane is further from the attorney's eye.

- **Fields are allow-listed** against `DESIGN_SHEET_IMPORT_FIELDS` — only what the
  extractor can propose, and therefore only what a review UI could have shown. A
  malformed or hostile body cannot reach `id`, `matter_id`, or a column nobody was
  shown. Refused, not dropped: ignoring a field silently would report success for
  a change that did not happen.
- **No fiduciary proposals.** The shared writer supports them and accepting one
  can mint a `contacts` row — creating a person in the firm's records from a Word
  pane, without the matching UI the dialog has, is not something to do
  sight-unseen. Fiduciary *names* still write back: `trustee_primary`,
  `guardian_primary` and the rest are ordinary allow-listed string fields.

### The conflict window

Reviewing takes as long as it takes, and the sheet may be edited in the web app
meanwhile. `propose` reads the sheet **before** extracting and returns its `id`
and `updated_at`; the pane hands both back on apply, and the writer's
compare-and-swap refuses a sheet that moved. The attorney is told to re-read
rather than having their copy win.

Reading the token before the extraction is deliberate — reading it after would
leave a window where the sheet changed and the token still looked fresh.

After a successful save the rows are cleared rather than left on screen: they now
describe a sheet that has changed, and re-saving them would be a write against a
stale token.

## How edits are applied

The model names a passage verbatim; the pane finds it with `body.search()` and
authors a tracked revision. That is the only handle Word gives an add-in — there
is no "change the text at position N" — which is why the prompt insists on a
verbatim, contiguous, unique `original` of at most 200 characters.

Two details are worth knowing before changing `src/word/applyTrackedEdits.ts`:

- **Never `insertText(..., Replace)`.** Word for Mac decomposes a tracked Replace
  into an *untracked* deletion plus a tracked insertion: the attorney's text
  disappears with nothing to reject, and the bug is invisible on Windows.
  Insert-after then delete is the only form every host records as a reviewable
  pair. `tests/word-addin-office-usage.test.ts` guards this.
- **Change tracking is forced on and restored in a `finally`.** Leaving
  `trackAll` on would silently change how the attorney's own typing behaves for
  the rest of the session.

Failures are reported, never swallowed: `not-found`, `ambiguous`, `skipped`
(unsearchable, or the passage already carries a revision), `error`. An edit the
model proposed but Word could not place is the most important thing to surface.

## The formatting pass

Two halves, working differently on purpose.

**Firm style** round-trips the document through the server so it reuses
`applyStyleSetToPart` — the same engine that formats every generated document.
Reimplementing those rules in Office.js would create a second engine that drifts
from the first. `Document.insertFileFromBase64` copies headers, footers, and
section properties by default, so page setup survives, which Office.js cannot
manage on Word for the web at all. The cost is a whole-document replace: one undo
step, and the cursor moves.

**Structure passes** run in Office.js, because they restructure paragraphs —
article titles onto their own line, notary blocks standardized, section intros run
into their headings. `lib/styleSets/defaults.ts` names these three as the work a
style set cannot express. They are regex-driven and will misjudge an unusual
document, so they preview before applying and apply as tracked changes.

## Known limitations

- **Desktop first.** Word on the web should work but is untested; Mac
  under-reports deleted revisions through `getTrackedChanges()`, which the pane
  notes on the card rather than treating as a failure.
- **Documents over roughly 3.5 MB** cannot be style-swept or saved as a version:
  both send the whole file, and Vercel caps the request body. The version save
  names the size before spending the upload; the style sweep does not.
- **The matter and document links are per-machine**, and a document must be
  linked by hand: nothing inside a `.docx` says which Cornerstone document or
  version it came from.
- **Write-back is a whole-document read, not a diff.** The Sheet tab extracts
  decisions from the document as it stands; it does not know which of them the
  attorney changed in this session. A document that has always said one thing
  proposes it just the same, which is why a row that would overwrite arrives
  unticked.

## Tests

```bash
npm test          # in word-addin/ — the pure logic
```

Root-suite tests cover the parts that must not drift: `tests/edit-protocol.test.ts`
pins the pane's copy of the edit contract against the server's,
`tests/word-addin-office-usage.test.ts` guards the host quirks above,
`tests/matter-brief.test.ts` pins the non-invention rule and the fencing on the
design sheet, `tests/design-sheet-write-back.test.ts` pins the write-back
allow-list and the propose/apply separation,
`tests/addin-document-versions.test.ts` pins the version save — one writer, v1
before v2, the stale-version refusal, and the absent edit cards — `tests/addin-route-auth.test.ts` enforces that every `/api/addin/*`
route gates itself, and `tests/word-addin-project.test.ts` guards the build
isolation that keeps this nested project out of the root typecheck, lint, and Next
build.

## Attribution

Architecturally informed by [Mike](https://github.com/open-legal-products/mike)
(MikeOSS), which is **AGPL-3.0**. Ideas only — the edit-protocol shape, the
failure vocabulary, the apply sequence. No Mike code is copied, and none should
be: the AGPL's network clause would apply to the whole Cornerstone service.

## Ribbon icon

`public/assets/icon.svg` is the source; `icon-16/32/80.png` are rendered from it
and are what `manifest.xml` points at. Regenerate from the repo root:

```bash
node -e "const s=require('sharp');for(const n of [16,32,80])s('word-addin/public/assets/icon.svg',{density:600}).resize(n,n,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).png().toFile(\`word-addin/public/assets/icon-\${n}.png\`)"
```

The mark is a laid cornerstone in the firm's navy and teal — deliberately not a
letterform, because Word's ribbon is already full of "A" icons for font size,
colour and style and a monogram there reads as a text control; and deliberately
not the firm wordmark, because "AUBREY | LAW" plus a tagline is 480×56 and at
16px it is an unreadable smear. Drop a square logo in and re-run the command
above if one turns up.

Word caches ribbon icons hard. After changing them, quit Word and run
`npm run clear-cache`.
