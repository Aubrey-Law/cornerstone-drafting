# tests/

Vitest unit tests for drafting logic, payload assembly, generation, and API auth coverage.

## Running

```sh
npm test              # one-shot
npm run test:watch    # interactive
```

## Required env

The harness reads `.env.test` first, then falls back to `.env.local`. Both are
git-ignored. Optional for most unit tests; integration-style tests need:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Use a Supabase branch DB or local `supabase start` — not production.

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
