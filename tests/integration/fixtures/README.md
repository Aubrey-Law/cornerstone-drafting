# Firm remediation SQL fixture

`firm-remediation.sql` is a deliberately minimal, synthetic PostgreSQL 17 catalog for the five remediation integration files. It is not a Supabase migration or a copy of client data. Use a fresh disposable container; never apply this fixture to the linked firm database or an existing Supabase instance.

`.github/workflows/integration-fixture.yml` now runs all five on every pull request that touches them, on a weekly schedule, and on demand, against a `postgres:17-alpine` service container built the same way. The procedure below stays, because it is still how you run them locally and how you debug a red job.

Prerequisites: Docker, local `psql`, installed project dependencies, supported Node 24. Use an unused loopback port and a unique container name. From the repository root:

```sh
docker run --rm -d --name cornerstone-remediation-test \
  -e POSTGRES_PASSWORD=synthetic-fixture -p 127.0.0.1:55493:5432 postgres:17-alpine
```

After `docker exec cornerstone-remediation-test pg_isready -U postgres` succeeds, apply the fixture, then the real additive migrations:

```sh
PGPASSWORD=synthetic-fixture psql -h 127.0.0.1 -p 55493 -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -f tests/integration/fixtures/firm-remediation.sql \
  -f supabase/migrations/20261123000000_workflow_job_leases.sql \
  -f supabase/migrations/20261124000000_working_list_reads.sql

PGPASSWORD=synthetic-fixture PGOPTIONS='-c check_function_bodies=off' \
  psql -h 127.0.0.1 -p 55493 -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20261128000000_hide_closed_matters.sql

PGPASSWORD=synthetic-fixture psql -h 127.0.0.1 -p 55493 -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20270102090600_canonical_record_attention.sql
```

The closed-matter migration goes on its own because of the second function it carries. `firm_matter_page_v1` is the one `matter-list-pagination` exercises and it reads only tables this fixture has; `drafting_hub_page`, in the same file, reads `design_sheets`, `doc_selections`, `drafting_hub_has_documents` and a dozen `matter_documents` columns the fixture deliberately does not stub, and no test here calls it. Postgres parses `language sql` bodies at creation time, so it would otherwise reject the file over a function nothing runs. `check_function_bodies=off` defers only that resolution — `ON_ERROR_STOP` still catches everything else.

The final migration replaces the old quiet/upload attention heuristic with the
ordered canonical work-graph ids supplied by the server. Leaving either
redefinition out makes `matter-list-pagination` exercise a stale contract.

```sh
INTEGRATION_SUPABASE_URL=http://127.0.0.1:9 \
INTEGRATION_SUPABASE_SERVICE_ROLE_KEY=synthetic \
INTEGRATION_DATABASE_URL=postgresql://postgres:synthetic-fixture@127.0.0.1:55493/postgres \
npm run test:integration -- \
  tests/integration/workflow-job-leases.test.ts \
  tests/integration/working-list-pagination.test.ts \
  tests/integration/matter-list-pagination.test.ts \
  tests/integration/lead-summary.test.ts \
  tests/integration/ledger-pagination.test.ts
```

The loopback REST markers satisfy the integration environment guard; these five tests use PostgreSQL directly. Fixture tables support large synthetic datasets, independent connection lease tests, and aggregate/reference parity. This does not replace testing against the full deployment catalog.

Clean up only the container you created:

```sh
docker stop cornerstone-remediation-test
```

## Two kinds of integration test

This fixture is one of two incompatible catalogs, and pointing a test at the wrong one produces
confusing failures (`relation "public.matter_fixture" does not exist`, or a not-null constraint on a
column this fixture's stub tables do not have).

- **`tests/integration/*.test.ts`** — the five files above. They need *this* fixture: a synthetic
  catalog with stub tables (`public.matters` is `(id uuid primary key)`) and fixture-only tables
  (`matter_fixture`, `lead_fixture`). Run under `vitest.integration.config.ts`
  (`npm run test:integration`), automatically by
  `.github/workflows/integration-fixture.yml`, and by hand per the procedure above.
- **`tests/integration/schema/**/*.test.ts`** — tests that need the *real migrated schema*, built by
  `supabase start` applying `supabase/migrations`. Real constraints are the point: this fixture
  declares two foreign keys in total and no e-sign tables, so it cannot express a defect like an
  invented `agreement_id` violating `esign_signing_sessions_agreement_id_fkey`. Run under
  `vitest.schema.config.ts` (`npm run test:schema`), automatically by
  `.github/workflows/integration-schema.yml`.

A new test belongs in `schema/` if it is about what the database refuses.
