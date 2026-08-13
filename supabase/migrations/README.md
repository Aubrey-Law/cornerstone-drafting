# Supabase migrations

The timestamped SQL files in this directory are the canonical, immutable schema history for
Cornerstone. Apply them in filename order. Once a migration has been applied to a shared
environment, add a new migration for every correction; do not edit the old file or paste a
mutable quick-fix copy into the SQL editor.

## Local development

The local database is disposable. After starting Docker and Supabase as described in
`AGENTS.md`, rebuild it from the complete migration chain and local grants with:

```bash
./node_modules/.bin/supabase db reset --local
```

`supabase/seed.sql` runs after migrations. It contains local role grants only; all schema
objects and columns must come from migrations.

Create a schema change with the CLI so filenames and timestamps remain consistent:

```bash
./node_modules/.bin/supabase migration new <description>
./node_modules/.bin/supabase db reset --local
./node_modules/.bin/supabase migration list --local
```

Review generated or handwritten SQL before committing it. Never put production data,
credentials, or client information in seed files.

## Linked shared firm database

The linked production/staging project is not disposable. Never run `db reset --linked`, and
never use migration repair merely to force a green status.

Before applying a change:

```bash
./node_modules/.bin/supabase migration list --linked
./node_modules/.bin/supabase db push --dry-run
```

If local and remote history diverge, inspect the remote catalog and migration history first.
Pull genuine remote schema changes or repair only history entries whose applied state has
been independently verified. Then repeat the dry run. Coordinate so only one operator pushes
at a time.

After an approved push, repeat `migration list`, verify the affected catalog objects, and run:

```bash
npm run check:db-rpcs
```

A migration-history row is not proof that its SQL executed. Missing relations, columns, or
RPCs require catalog verification and reconciliation, not manual insertion into migration
history.

## Version collisions

Two files must never share a timestamp. `db push` applies a version once and records it
once, so the second file's SQL never runs — and nothing reports it as pending afterwards,
because the version reads as applied. `npm run check:migration-drift` fails on this, on
every pull request, with no database access needed. Fix it by renumbering the file that has
not been applied yet:

```bash
git mv supabase/migrations/<version>_<name>.sql supabase/migrations/<new-version>_<name>.sql
```

Always create migrations with `supabase migration new`, which stamps the current time, rather
than hand-typing a timestamp — two branches picking the same round number is how this
happens.

## Recovering DDL applied out of band

When the history records a version no file describes — DDL applied through the dashboard, the
SQL editor, or an agent with direct database access — the repo is what is missing, not the
database. Write the file back from the SQL the history recorded:

```bash
npm run check:migration-drift -- --write-missing
```

Review the generated file, confirm it is safe to replay against a fresh database (`supabase
db reset --local`), and commit it. Reach for `supabase migration repair --status reverted`
only when the version was stamped for something another file already describes; it discards
the record of DDL that is genuinely applied.

### The same work stamped twice

Applying DDL by hand *around* the time its own migration lands records it twice: once under
the file's version, once under the wall-clock version the manual apply stamped. The second
row is an orphan, but the repo is not missing anything — writing it back would commit the
same DDL again, numbered behind every migration merged since, which the out-of-order check
then fails on.

`npm run check:migration-drift` tells this apart by the recorded name: an orphan whose name
matches a migration file sitting at a different version is reported as a restamp, with the
repair command for it, and `--write-missing` skips it. Drop the stray row:

```bash
./node_modules/.bin/supabase migration repair --status reverted <wall-clock-version>
```

Then confirm the columns or objects the migration created are really in the catalog — a
history row is not proof its SQL ran, in either direction.

## When the CLI is killed on start (macOS)

Every command dies instantly with no output, and the npm wrapper reports `signal: 'SIGKILL'`,
`status: null`, and null stdout/stderr — the binary was killed at exec, before it ran, so
nothing it would have printed exists. It is not the subcommand: `supabase --version` fails
the same way.

The platform package ships **two** Mach-O binaries, and `bin/supabase` execs `bin/supabase-go`:

```
node_modules/@supabase/cli-darwin-arm64/bin/supabase      (~109 MB)
node_modules/@supabase/cli-darwin-arm64/bin/supabase-go   (~100 MB)
```

Signing only the first is the usual half-fix — the command starts, then dies the moment the
CLI shells out. Clear extended attributes and ad-hoc sign both. Apple Silicon requires at
least an ad-hoc signature, or the kernel kills the process on sight:

```bash
PKG=node_modules/@supabase/cli-darwin-arm64   # or cli-darwin-x64 on Intel
xattr -cr "$PKG"
codesign --force --sign - "$PKG/bin/supabase-go"
codesign --force --sign - "$PKG/bin/supabase"
./node_modules/.bin/supabase --version
```

If either file is kilobytes rather than ~100 MB, or `file` reports anything but a Mach-O of
this machine's architecture, the download is truncated or wrong — reinstall instead:

```bash
rm -rf node_modules/@supabase/cli-darwin-arm64 node_modules/supabase && npm install
```

Signing is undone by the next `npm ci`, which re-extracts the same binaries. If it recurs
there, the signature is what breaks; if it does not, a quarantine attribute was the one-off
cause. `brew install supabase/tap/supabase` avoids both, but then watch version drift against
the pinned `supabase` devDependency before any `db push`, and use the bare `supabase` rather
than the `./node_modules/.bin/supabase` spelled everywhere above.

Confirm it reaches the project, not just that it starts — this exercises the auth and the
link that `db push` depends on, which `--version` does not:

```bash
./node_modules/.bin/supabase migration list --linked
```

## Storage

Estate-plan template fallback uses a private Supabase Storage bucket named `templates`.
Document bytes otherwise live in Cloudflare R2.

The administrator Template Center uses the separate private
`document-template-versions` bucket. Migration
`20260713194628_document_template_workflow.sql` creates and secures that bucket; server-side
service-role handlers are its only application access path.
