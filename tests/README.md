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
