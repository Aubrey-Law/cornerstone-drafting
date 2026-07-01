# tests/

Vitest-based integration tests. Currently scoped to RLS regression coverage.

## Running

```sh
pnpm test              # one-shot
pnpm test:watch        # interactive
```

## Required env

The harness reads `.env.test` first, then falls back to `.env.local`. Both are
git-ignored. Required:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — needed to introspect schema and seed fixtures.

The cross-tenant isolation block additionally needs:

- `RLS_TEST_USER_A_JWT` — long-lived access token for a seeded client A
- `RLS_TEST_USER_A_ID`
- `RLS_TEST_USER_B_JWT`
- `RLS_TEST_USER_B_ID`

To get JWTs without the password flow, you can mint them via the Supabase
admin API (`generateLink({ type: 'magiclink' })`) or by signing in two
test clients and copying the bearer token from the network tab.

## Database target

By default tests run against whatever `NEXT_PUBLIC_SUPABASE_URL` points at.
**Don't run them against production** — service-role queries here don't
mutate, but the cross-tenant tests assume two specific seeded users exist.
Use a Supabase branch DB (`mcp__supabase__create_branch`) or a local
`supabase start` instance.
