# Cornerstone Word Add-in

A Word task pane for drafting: chat about the open document and apply the model's
revisions as native tracked changes, plus the firm formatting pass.

Prototype status — sideloaded, firm-internal. Not published to AppSource.

## Running it

Three terminals. The first two stay running; the third is a one-shot.

```bash
# 1 — Cornerstone, from the repo root
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

**First run only:** macOS protects Word's add-in folder from other processes, so
`npm start` is refused until you grant the terminal access.

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

Then **quit Word completely (⌘Q) and reopen it** — a running Word does not
rescan the sideload folder. Open a document and pick **Cornerstone** from the
Home ribbon, or **Insert → My Add-ins → Cornerstone**.

`npm run stop` unregisters it. The sideloaded manifest is a *copy*, so re-run
`npm start` after editing `manifest.xml`.

The first `npm run dev` mints a local HTTPS certificate and asks for your
keychain password; Office refuses to load a task pane over plain HTTP. Set
`DEV_HTTPS_CERT` and `DEV_HTTPS_KEY` to serve existing cert files instead, which
is the only way through in a headless environment.

Point the pane at a different backend with `CORNERSTONE_ORIGIN`.

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
removes the need for CORS in one move. It also puts the sign-in dialog on the
pane's own origin, which is required for `messageParent` to work at all.

In production the pane should be served by the Next app itself, keeping the same
property without a proxy.

## Signing in

The pane holds a Supabase access token, not a cookie — Word blocks third-party
cookies, and the Cornerstone session cookie belongs to a different origin.

`Sign in` opens an Office dialog at `/auth/addin`, which redirects to the normal
staff login and then hands the token back via `messageParent`. The token lives in
`localStorage`, deliberately not in `Office.context.document.settings`: document
settings are embedded in the `.docx`, so a token stored there would travel with
the file to whoever received it.

**Dev caveat:** staff OAuth redirects to Supabase's configured site URL (port
3002), which lands outside the dialog. Use email and password in dev. In
production, pane and login share an origin and OAuth returns correctly.

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
| `GET /api/addin/style-set` | The firm's active `StyleSetSettings` |
| `POST /api/addin/style-set/apply` | Style-sweep a `.docx` and return the bytes |

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

- **No version history.** The add-in edits whatever file is open on disk.
  `/api/documents/[id]/edits` writes a new R2 version and `document_edits` rows;
  this path does neither, and the two do not reconcile. Fine for a prototype,
  not something to discover in production.
- **Desktop first.** Word on the web should work but is untested; Mac
  under-reports deleted revisions through `getTrackedChanges()`, which the pane
  notes on the card rather than treating as a failure.
- **A first-time staff user with no `users` row gets a 403** with no explanation.
  Open the Cornerstone web app once first.
- Documents over ~3.5 MB are rejected by the style sweep (Vercel body limit).

## Tests

```bash
npm test          # in word-addin/ — the pure logic
```

Root-suite tests cover the parts that must not drift: `tests/edit-protocol.test.ts`
pins the pane's copy of the edit contract against the server's,
`tests/word-addin-office-usage.test.ts` guards the host quirks above, and
`tests/word-addin-project.test.ts` guards the build isolation that keeps this
nested project out of the root typecheck, lint, and Next build.

## Attribution

Architecturally informed by [Mike](https://github.com/open-legal-products/mike)
(MikeOSS), which is **AGPL-3.0**. Ideas only — the edit-protocol shape, the
failure vocabulary, the apply sequence. No Mike code is copied, and none should
be: the AGPL's network clause would apply to the whole Cornerstone service.
