# Firm remediation SQL fixture

`firm-remediation.sql` is a deliberately minimal, synthetic PostgreSQL 17 catalog for the five remediation integration files. It is not a Supabase migration or a copy of client data. Use a fresh disposable container; never apply this fixture to the linked firm database or an existing Supabase instance.

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
