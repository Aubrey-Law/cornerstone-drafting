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

## Storage

Estate-plan template fallback uses a private Supabase Storage bucket named `templates`.
Document bytes otherwise live in Cloudflare R2.

The administrator Template Center uses the separate private
`document-template-versions` bucket. Migration
`20260713194628_document_template_workflow.sql` creates and secures that bucket; server-side
service-role handlers are its only application access path.
