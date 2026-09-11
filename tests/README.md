# tests/

Vitest unit tests for drafting logic, payload assembly, generation, and API auth coverage.

## Running

```sh
npm test              # one-shot
npm run test:watch    # interactive
```

## Test environments

Unit tests do not load `.env.test` or `.env.local`. The setup discards inherited
application credentials and installs synthetic Supabase values. Mock external
clients in tests; do not send to real services from the unit suite.

Real-service tests live under `tests/integration/` and run only with
`npm run test:integration`. Supply `INTEGRATION_SUPABASE_URL`,
`INTEGRATION_SUPABASE_SERVICE_ROLE_KEY`, and (for client auth tests)
`INTEGRATION_SUPABASE_ANON_KEY`. The runner accepts loopback URLs only and
fails before constructing clients for missing credentials or remote targets.

## Browser-testing fixture

For real-browser checks of the lead, matter, and portal pages, seed the local
stack with a deterministic authenticated fixture:

```sh
npm run seed:browser-fixture
```

It is idempotent and creates a staff login (`attorney@example.com` /
`Password123!`), a client portal login (`client@example.com` /
`Password123!`), a lead, and a hired matter (via the same
`convert_lead_to_matter` RPC the app uses), then prints the URLs to visit.
The script refuses non-local Supabase URLs unless `--allow-remote` is passed.
