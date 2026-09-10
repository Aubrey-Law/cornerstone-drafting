# Matters MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A stdio MCP server that lets an agent inspect and safely correct cornerstone matter records, replacing the `aubreylaw-matters` server that speaks a different application's schema.

**Architecture:** Three tools over the Supabase JS client with the service key. Every write goes through one `security definer` RPC, `correct_matter`, which carries the field allow-list, the optimistic-concurrency check, and the audit-row insert in a single transaction — because PostgREST cannot run a multi-statement transaction, and a client that updates the matter and then writes the audit row can fail between the two.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk` ^1.30.0, `@supabase/supabase-js` ^2.100.1, `zod` ^3.25.0, vitest, plpgsql.

**Spec:** `docs/superpowers/specs/2026-09-09-matters-mcp-design.md`

---

## Facts you need before starting

These were all verified against the repository and the live database on 2026-09-09. Do not re-derive them; do not assume anything not listed here.

**The real column names.** Getting these wrong cost five exploratory queries when this work was done by hand:

| table | columns you will use |
| --- | --- |
| `public.matters` | `id` (uuid), `name`, `matter_number`, `stage`, `relationship_status`, `status`, `matter_type` |
| `public.design_sheets` | `matter_id`, `version`, `client_name`, `spouse_name` |
| `public.matter_contacts` | `matter_id`, `contact_id`, `relationship_type`, `relationship_label` |
| `public.contacts` | `first_name`, `middle_name`, `last_name`, `preferred_name` |
| `public.matter_activity` | `matter_id` (**text**, not uuid), `event_type`, `actor_id`, `actor_email`, `actor_name`, `title`, `detail`, `metadata` |

There is **no** `matter_contacts.role`, no `contacts.full_name`, no `public.documents`, and no `signing_ceremonies.scheduled_at`. Each of those was tried and does not exist.

**Repository wiring that is not automatic:**

- `package.json`'s `workspaces` is an explicit list — `["apps/*", "packages/*", "tools/aubreylaw-docgeneration", "tools/workflows"]`. It is **not** `tools/*`. A new tool directory is not a workspace until it is added.
- The root `lint` script names its directories explicitly. A new directory is not linted until it is added.
- The root `typecheck` (`tsconfig.typecheck.json`) includes `**/*.ts` and excludes only `node_modules`, `supabase/functions`, `word-addin`, `apps`, `.next`. So `tools/matters-mcp/src/**.ts` **is** typechecked already. No change needed.
- The root vitest config collects `tests/**/*.test.ts` **only**. A test file under `tools/matters-mcp/tests/` would never run. All tests in this plan therefore live in root `tests/`, despite the spec sketching them beside the code — a test that does not run is worse than a test in a slightly odd place.
- CI's test step (`.github/workflows/app-ci.yml`, `npm test -- --reporter=dot`) is given **no Supabase environment**. Tests cannot reach the database in CI. Structural facts about the migration are asserted against its SQL text, which is the idiom `tests/engagement-repository.test.ts` already uses; behaviour is verified by hand in Task 6 against the real database inside a rolled-back transaction.
- `scripts/checkDbRpcs.mjs` verifies that every RPC the code calls exists in PostgREST. Its `SOURCE_DIRS` are `app`, `lib`, `components`, `apps/workbench/app`, `apps/workbench/lib`. A `tools/` directory is invisible to it.

**Migration naming:** `supabase/migrations/YYYYMMDDHHMMSS_name.sql`. The latest is `20261117000000_identity_task_source.sql`, so this one is `20261118000000_correct_matter.sql`.

**Never** verify an applied migration from `supabase_migrations.schema_migrations`. This project has had a migration recorded as applied whose body never ran. Verify from the catalog (`pg_proc`) or from PostgREST's OpenAPI document.

---

## File Structure

| file | responsibility |
| --- | --- |
| `tools/matters-mcp/package.json` | workspace manifest, deps, `dev` script |
| `tools/matters-mcp/src/client.ts` | build a typed Supabase client from the environment; nothing else |
| `tools/matters-mcp/src/matters.ts` | the three operations as plain functions taking a client — all the logic, no MCP |
| `tools/matters-mcp/src/tools.ts` | zod argument schemas, MCP registration, error text |
| `tools/matters-mcp/src/stdio.ts` | process entry: build client, register tools, connect transport |
| `supabase/migrations/20261118000000_correct_matter.sql` | the `correct_matter` function |
| `tests/matters-mcp.test.ts` | operations against a fake client, plus the migration's SQL text |
| `package.json` | add the workspace, add the lint directory |
| `scripts/checkDbRpcs.mjs` | add `tools/matters-mcp/src` to `SOURCE_DIRS` |

`matters.ts` holds the logic and takes a client as its first argument, so every operation is testable with a fake and none of it needs the MCP SDK loaded. `tools.ts` is the only file that knows about MCP.

---

### Task 1: The workspace, and the wiring that is not automatic

**Files:**
- Create: `tools/matters-mcp/package.json`
- Modify: `package.json` (workspaces array, lint script)
- Modify: `scripts/checkDbRpcs.mjs` (SOURCE_DIRS)
- Test: `tests/matters-mcp.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/matters-mcp.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(__dirname, '..')
const readJson = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8'))

/**
 * The wiring nothing else catches.
 *
 * Three separate lists in this repository have to name a new tool directory
 * before it is built, linted, or verified, and none of them uses a glob. A
 * missing entry fails silently: the package is not installed, the code is not
 * linted, or — worst — the RPC it calls is never cross-checked against the
 * database, which is the one failure `checkDbRpcs.mjs` exists to prevent.
 */
describe('matters-mcp is wired into the repository', () => {
  it('is an npm workspace, since the list is explicit and not a glob', () => {
    expect(readJson('package.json').workspaces).toContain('tools/matters-mcp')
  })

  it('has its RPC calls cross-checked against the database', () => {
    const checker = readFileSync(join(root, 'scripts/checkDbRpcs.mjs'), 'utf8')
    const dirs = checker.match(/const SOURCE_DIRS = \[([\s\S]*?)\]/)?.[1] ?? ''
    expect(dirs).toContain('tools/matters-mcp/src')
  })

  it('declares the dependencies its source imports', () => {
    const pkg = readJson('tools/matters-mcp/package.json')
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    for (const dep of ['@modelcontextprotocol/sdk', '@supabase/supabase-js', '@aubrey-law/db-types', 'zod']) {
      expect(Object.keys(deps)).toContain(dep)
    }
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/matters-mcp.test.ts`
Expected: FAIL — three failures, the last being `ENOENT` on `tools/matters-mcp/package.json`.

- [ ] **Step 3: Create the package manifest**

Create `tools/matters-mcp/package.json`:

```json
{
  "name": "@aubrey-law/matters-mcp",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Stdio MCP server for inspecting and correcting cornerstone matter records. Replaces the aubreylaw-matters server, which belongs to a different application with a different schema.",
  "scripts": {
    "dev": "tsx src/stdio.ts"
  },
  "dependencies": {
    "@aubrey-law/db-types": "*",
    "@modelcontextprotocol/sdk": "^1.30.0",
    "@supabase/supabase-js": "^2.100.1",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "tsx": "^4.21.0"
  }
}
```

- [ ] **Step 4: Add the workspace**

In the root `package.json`, add `"tools/matters-mcp"` to the end of the `workspaces` array.

**Do not touch the lint script here.** ESLint 9 exits 2 on a path that does not
resolve — not a warning, not a skip — so naming `tools/matters-mcp/src` before
any source file exists breaks `npm run lint` for the *whole repository*, `app`
and `lib` included. Measured: `npm run lint` → `exit=2`,
`No files matching the pattern "tools/matters-mcp/src" were found`. Pointing at
`tools/matters-mcp` instead does not help either. The lint registration is
therefore Task 2's, landing in the same commit as the first `.ts` file.

(The `checkDbRpcs.mjs` entry in the next step is safe to add now: that script
wraps `readdirSync` in try/catch and returns `[]` for a missing directory.)

- [ ] **Step 5: Teach the RPC checker about the new directory**

In `scripts/checkDbRpcs.mjs`, the `SOURCE_DIRS` array currently ends with `'apps/workbench/lib',`. Add a line after it:

```js
  // The matters MCP server. Not part of either app, and its one RPC
  // (`correct_matter`) is the only write path an agent has into matters — so
  // an unverified call here is the failure this script exists to catch.
  'tools/matters-mcp/src',
```

- [ ] **Step 6: Install and run the tests**

```bash
npm install
npx vitest run tests/matters-mcp.test.ts
```

Expected: PASS, 3 tests. `npm install` creates `node_modules/@aubrey-law/matters-mcp` as a symlink and installs the MCP SDK.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json scripts/checkDbRpcs.mjs tools/matters-mcp/package.json tests/matters-mcp.test.ts
git commit -m "A workspace for the matters MCP server, and the three lists that must name it

Workspaces, the lint directory list, and checkDbRpcs' SOURCE_DIRS are all
explicit lists rather than globs. A missing entry fails silently, and the
worst of the three is the RPC checker: an unverified call is exactly what
that script was written to catch.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The client factory

**Files:**
- Create: `tools/matters-mcp/src/client.ts`
- Test: `tests/matters-mcp.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/matters-mcp.test.ts`:

```ts
import { mattersClientConfig } from '../tools/matters-mcp/src/client'

/**
 * Configuration is read as a pure function of an environment object, so the
 * refusal can be tested without mutating `process.env` and without a network
 * call. A server that starts with a missing key and fails on the first tool
 * call reports the problem far from its cause.
 */
describe('mattersClientConfig', () => {
  it('reads the url and service key', () => {
    expect(
      mattersClientConfig({
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      }),
    ).toEqual({ url: 'https://example.supabase.co', serviceKey: 'service-key' })
  })

  it('accepts NEXT_PUBLIC_SUPABASE_URL, which is what .env.local actually sets', () => {
    expect(
      mattersClientConfig({
        NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      }).url,
    ).toBe('https://example.supabase.co')
  })

  it('names the variable that is missing rather than failing later', () => {
    expect(() => mattersClientConfig({ SUPABASE_URL: 'https://example.supabase.co' })).toThrow(
      /SUPABASE_SERVICE_ROLE_KEY/,
    )
    expect(() => mattersClientConfig({ SUPABASE_SERVICE_ROLE_KEY: 'k' })).toThrow(/SUPABASE_URL/)
  })

  it('treats an empty string as missing, because a blank env var is the common case', () => {
    expect(() =>
      mattersClientConfig({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: '  ' }),
    ).toThrow(/SUPABASE_SERVICE_ROLE_KEY/)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/matters-mcp.test.ts`
Expected: FAIL — `Cannot find package '../tools/matters-mcp/src/client'` (vitest 4 words this "package", not "module").

- [ ] **Step 3: Write the implementation**

Create `tools/matters-mcp/src/client.ts`:

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@aubrey-law/db-types'

export type MattersClient = SupabaseClient<Database>

export interface MattersClientConfig {
  url: string
  serviceKey: string
}

/**
 * The environment this server needs, as a pure function of an environment
 * object so it can be tested without touching `process.env`.
 *
 * The service key is deliberate: this server's whole purpose is correcting
 * records, and it runs as an operator tool rather than on behalf of a signed-in
 * user. RLS is therefore bypassed — which is why the guardrails live in
 * `correct_matter` rather than in a policy.
 */
export function mattersClientConfig(env: Record<string, string | undefined>): MattersClientConfig {
  const url = present(env.SUPABASE_URL) ?? present(env.NEXT_PUBLIC_SUPABASE_URL)
  if (!url) throw new Error('SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) is not set')

  const serviceKey = present(env.SUPABASE_SERVICE_ROLE_KEY)
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')

  return { url, serviceKey }
}

/** A value that is set and not blank. A blank env var is the common failure. */
function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : undefined
}

export function createMattersClient(config: MattersClientConfig): MattersClient {
  return createClient<Database>(config.url, config.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
```

- [ ] **Step 4: Register the directory for linting, now that it has a file in it**

This is Task 1's leftover, deferred to here on purpose. In the root
`package.json`'s `scripts.lint`, insert ` tools/matters-mcp/src` immediately
before ` eslint.config.mjs`, so the value reads:

```
eslint app components hooks lib types packages/citations/src packages/db-types/src packages/drafting-engine/src packages/ui/src tools/matters-mcp/src eslint.config.mjs
```

Add its guard to `tests/matters-mcp.test.ts`, inside the existing
`describe('matters-mcp is wired into the repository', …)` block:

```ts
  it('is linted, since the lint script names its directories', () => {
    expect(readJson('package.json').scripts.lint).toContain('tools/matters-mcp/src')
  })
```

- [ ] **Step 5: Run the tests, and confirm lint actually passes**

```bash
npx vitest run tests/matters-mcp.test.ts
npm run lint; echo "exit=$?"
```

Expected: PASS, 8 tests (3 wiring + 1 lint + 4 config); lint `exit=0`. The `exit=` line is the point — ESLint
prints warnings and still exits 0, so eyeballing the output does not tell you
whether it passed.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add package.json tools/matters-mcp/src/client.ts tests/matters-mcp.test.ts
git commit -m "A typed client for the matters MCP, refusing a blank key up front

Configuration is a pure function of an environment object so the refusal is
testable without mutating process.env. A server that starts with a missing
key and fails on the first tool call reports the problem far from its cause.

Registers the directory for linting too. That belongs here rather than with
the rest of the wiring: ESLint 9 exits 2 on a path that does not resolve, so
the entry is only safe once a source file exists.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The read operations

**Files:**
- Create: `tools/matters-mcp/src/matters.ts`
- Test: `tests/matters-mcp.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/matters-mcp.test.ts`:

```ts
import { getMatter, listMatters } from '../tools/matters-mcp/src/matters'

/**
 * A fake standing in for the query builder, recording what was asked and
 * returning what the test supplies. Every method returns `this` so a chain of
 * any shape resolves, and the object is thenable so `await` on the chain
 * yields the result.
 */
function fakeClient(byTable: Record<string, { data: unknown; error: { message: string } | null }>) {
  const calls: Array<{ table: string; filters: Array<[string, unknown]> }> = []
  return {
    calls,
    from(table: string) {
      const record = { table, filters: [] as Array<[string, unknown]> }
      calls.push(record)
      const result = byTable[table] ?? { data: [], error: null }
      const chain: Record<string, unknown> = {
        select: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: () => Promise.resolve(result),
        eq: (column: string, value: unknown) => {
          record.filters.push([column, value])
          return chain
        },
        in: (column: string, value: unknown) => {
          record.filters.push([column, value])
          return chain
        },
        ilike: (column: string, value: unknown) => {
          record.filters.push([column, value])
          return chain
        },
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
      }
      return chain
    },
  }
}

const MATTER_ROW = {
  id: '0528d2db-010d-4784-b683-784351597cc3',
  name: 'Can Cheng — Estate Planning',
  matter_number: 'M-0042',
  stage: 'client_review',
  relationship_status: 'hired',
  status: 'active',
  matter_type: 'couple',
}

describe('listMatters', () => {
  it('returns the summary fields, renamed to the shape a caller reads', async () => {
    const client = fakeClient({ matters: { data: [MATTER_ROW], error: null } })
    const result = await listMatters(client as never, {})
    expect(result.matters).toEqual([
      {
        id: '0528d2db-010d-4784-b683-784351597cc3',
        name: 'Can Cheng — Estate Planning',
        matterNumber: 'M-0042',
        stage: 'client_review',
        relationshipStatus: 'hired',
      },
    ])
  })

  it('filters on the columns it was given, and only those', async () => {
    const client = fakeClient({ matters: { data: [], error: null } })
    await listMatters(client as never, { relationshipStatus: 'hired', stage: 'drafting' })
    expect(client.calls[0].filters).toEqual([
      ['relationship_status', 'hired'],
      ['stage', 'drafting'],
    ])
  })

  it('searches the name with a contains pattern', async () => {
    const client = fakeClient({ matters: { data: [], error: null } })
    await listMatters(client as never, { nameContains: 'Cheng' })
    expect(client.calls[0].filters).toEqual([['name', '%Cheng%']])
  })

  it('throws rather than reporting an empty list when the query fails', async () => {
    const client = fakeClient({ matters: { data: null, error: { message: 'connection reset' } } })
    // An empty list from a failed query is indistinguishable from "no matters
    // match", and the caller would act on the wrong one.
    await expect(listMatters(client as never, {})).rejects.toThrow(/connection reset/)
  })
})

describe('getMatter', () => {
  it('assembles the matter, its latest sheet, and its contacts into one answer', async () => {
    const client = fakeClient({
      matters: { data: MATTER_ROW, error: null },
      design_sheets: {
        data: [
          { version: 1, client_name: 'Jie Cheng', spouse_name: 'Zilong Zhang' },
          { version: 2, client_name: 'Jie Cheng', spouse_name: 'Zilong Zhang' },
        ],
        error: null,
      },
      matter_contacts: {
        data: [
          {
            relationship_type: 'self',
            relationship_label: null,
            contacts: { first_name: 'Jie', middle_name: null, last_name: 'Cheng', preferred_name: null },
          },
          {
            relationship_type: 'spouse',
            relationship_label: 'Spouse',
            contacts: { first_name: 'Zilong', middle_name: null, last_name: 'Zhang', preferred_name: null },
          },
        ],
        error: null,
      },
    })

    const result = await getMatter(client as never, MATTER_ROW.id)

    expect(result.matter.name).toBe('Can Cheng — Estate Planning')
    // The highest version, not the first row returned.
    expect(result.sheet).toEqual({ version: 2, clientName: 'Jie Cheng', spouseName: 'Zilong Zhang' })
    expect(result.contacts).toEqual([
      { relationshipType: 'self', relationshipLabel: null, name: 'Jie Cheng', preferredName: null },
      { relationshipType: 'spouse', relationshipLabel: 'Spouse', name: 'Zilong Zhang', preferredName: null },
    ])
  })

  it('collapses the whitespace a missing middle name leaves behind', async () => {
    const client = fakeClient({
      matters: { data: MATTER_ROW, error: null },
      design_sheets: { data: [], error: null },
      matter_contacts: {
        data: [
          {
            relationship_type: 'self',
            relationship_label: null,
            contacts: { first_name: 'Yun', middle_name: null, last_name: 'Zhou', preferred_name: null },
          },
        ],
        error: null,
      },
    })
    const result = await getMatter(client as never, MATTER_ROW.id)
    expect(result.contacts[0].name).toBe('Yun Zhou')
  })

  it('reports no sheet rather than inventing one', async () => {
    const client = fakeClient({
      matters: { data: MATTER_ROW, error: null },
      design_sheets: { data: [], error: null },
      matter_contacts: { data: [], error: null },
    })
    expect((await getMatter(client as never, MATTER_ROW.id)).sheet).toBeNull()
  })

  it('throws when the matter does not exist', async () => {
    const client = fakeClient({
      matters: { data: null, error: null },
      design_sheets: { data: [], error: null },
      matter_contacts: { data: [], error: null },
    })
    await expect(getMatter(client as never, MATTER_ROW.id)).rejects.toThrow(/No matter/)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/matters-mcp.test.ts`
Expected: FAIL — `Cannot find package '../tools/matters-mcp/src/matters'`.

- [ ] **Step 3: Write the implementation**

Create `tools/matters-mcp/src/matters.ts`:

```ts
import type { MattersClient } from './client'

/**
 * The three operations, as plain functions taking a client.
 *
 * No MCP types appear here on purpose: every rule is then testable against a
 * fake client without loading the SDK, and `tools.ts` stays a thin adapter.
 *
 * The column lists are string constants in this file so `scripts/checkDbColumns.mjs`
 * can see them — the same reason `apps/workbench/lib/prompts/designSheet.ts`
 * does it.
 */

const MATTER_SUMMARY_SELECT = 'id, name, matter_number, stage, relationship_status'
const MATTER_DETAIL_SELECT = 'id, name, matter_number, stage, relationship_status, status, matter_type'
const SHEET_SELECT = 'version, client_name, spouse_name'
const CONTACT_SELECT =
  'relationship_type, relationship_label, contacts ( first_name, middle_name, last_name, preferred_name )'

export interface MatterSummary {
  id: string
  name: string
  matterNumber: string | null
  stage: string | null
  relationshipStatus: string
}

export interface MatterDetail {
  matter: MatterSummary & { status: string; matterType: string | null }
  sheet: { version: number; clientName: string | null; spouseName: string | null } | null
  contacts: Array<{
    relationshipType: string
    relationshipLabel: string | null
    name: string
    preferredName: string | null
  }>
}

export interface ListMattersFilter {
  relationshipStatus?: string
  stage?: string
  nameContains?: string
}

/** Enough rows to survey the practice, few enough not to dump every client name. */
const LIST_LIMIT = 100

export async function listMatters(
  client: MattersClient,
  filter: ListMattersFilter,
): Promise<{ matters: MatterSummary[] }> {
  let query = client.from('matters').select(MATTER_SUMMARY_SELECT)
  if (filter.relationshipStatus) query = query.eq('relationship_status', filter.relationshipStatus)
  if (filter.stage) query = query.eq('stage', filter.stage)
  if (filter.nameContains) query = query.ilike('name', `%${filter.nameContains}%`)

  const { data, error } = await query.order('name').limit(LIST_LIMIT)
  // Throw rather than return an empty list. "No matters match" and "the query
  // failed" look identical to a caller that only sees rows, and the caller
  // would act on the wrong one.
  if (error) throw new Error(`Could not list matters: ${error.message}`)

  return { matters: (data ?? []).map(summaryOf) }
}

export async function getMatter(client: MattersClient, matterId: string): Promise<MatterDetail> {
  const { data: matter, error: matterError } = await client
    .from('matters')
    .select(MATTER_DETAIL_SELECT)
    .eq('id', matterId)
    .maybeSingle()
  if (matterError) throw new Error(`Could not read matter ${matterId}: ${matterError.message}`)
  if (!matter) throw new Error(`No matter ${matterId}`)

  const { data: sheets, error: sheetError } = await client
    .from('design_sheets')
    .select(SHEET_SELECT)
    .eq('matter_id', matterId)
  if (sheetError) throw new Error(`Could not read design sheets for ${matterId}: ${sheetError.message}`)

  const { data: contacts, error: contactError } = await client
    .from('matter_contacts')
    .select(CONTACT_SELECT)
    .eq('matter_id', matterId)
  if (contactError) throw new Error(`Could not read contacts for ${matterId}: ${contactError.message}`)

  // The highest version, not the first row: PostgREST returns no order unless
  // one is asked for, and the latest sheet is the one being drafted from.
  //
  // The accumulator is typed through an explicit alias rather than
  // `(typeof sheets)[number]`, which does not compile — `sheets` may be null,
  // and you cannot index a nullable type.
  type SheetRow = { version: number; client_name: string | null; spouse_name: string | null }
  const latest = ((sheets ?? []) as SheetRow[]).reduce<SheetRow | null>(
    (best, row) => (best === null || row.version > best.version ? row : best),
    null,
  )

  return {
    matter: { ...summaryOf(matter), status: matter.status, matterType: matter.matter_type },
    sheet: latest
      ? { version: latest.version, clientName: latest.client_name, spouseName: latest.spouse_name }
      : null,
    // `relationship_type` is reported verbatim, including the handful of rows
    // that say `client` where the rest say `self`. Normalising it here would
    // hide a real inconsistency behind a tool whose purpose is finding them.
    contacts: (contacts ?? []).map((row) => ({
      relationshipType: row.relationship_type,
      relationshipLabel: row.relationship_label,
      name: assembleName(row.contacts),
      preferredName: row.contacts?.preferred_name ?? null,
    })),
  }
}

function summaryOf(row: {
  id: string
  name: string
  matter_number: string | null
  stage: string | null
  relationship_status: string
}): MatterSummary {
  return {
    id: row.id,
    name: row.name,
    matterNumber: row.matter_number,
    stage: row.stage,
    relationshipStatus: row.relationship_status,
  }
}

/**
 * There is no `full_name` column; the name is assembled from three parts, any
 * of which may be null. Joining with a space and collapsing runs is what keeps
 * a missing middle name from leaving a double space.
 */
function assembleName(contact: {
  first_name: string | null
  middle_name: string | null
  last_name: string | null
} | null): string {
  return [contact?.first_name, contact?.middle_name, contact?.last_name]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ')
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/matters-mcp.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Typecheck, lint, and commit**

```bash
npm run typecheck
npm run lint
git add tools/matters-mcp/src/matters.ts tests/matters-mcp.test.ts
git commit -m "Read a matter with the sheet and contacts that contradict it

getMatter answers in one call what took five queries by hand: the matter,
its latest design sheet, and every linked contact. That join is the whole
deliverable — a disagreement is only visible when the three are side by
side.

A failed query throws rather than returning an empty list, because 'no rows'
and 'the query failed' are the same shape to a caller that only sees rows.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The `correct_matter` migration

**Files:**
- Create: `supabase/migrations/20261118000000_correct_matter.sql`
- Test: `tests/matters-mcp.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/matters-mcp.test.ts`:

```ts
/**
 * The migration's SQL text.
 *
 * CI's test job gets no Supabase environment, so nothing here can call the
 * function. These assertions cover the structural facts that would be silently
 * wrong — the guardrails being present, the audit insert being in the same
 * statement block, the uuid-to-text cast — and Task 6 verifies the behaviour by
 * hand against the real database in a rolled-back transaction.
 *
 * This is the idiom `tests/engagement-repository.test.ts` already uses.
 */
describe('the correct_matter migration', () => {
  const sql = readFileSync(join(root, 'supabase/migrations/20261118000000_correct_matter.sql'), 'utf8')

  it('is a security definer function with a pinned search_path', () => {
    expect(sql).toContain('security definer set search_path = pg_catalog, public')
  })

  it('refuses every field except the three that are corrigible', () => {
    expect(sql).toMatch(/not in \('name', 'matter_number', 'matter_type'\)/)
    // Absent by construction: a stage change fires trg_matters_fire_stage_prompts,
    // which enqueues real drafting runs.
    expect(sql).not.toMatch(/set[\s\S]{0,80}\bstage\s*=/)
    expect(sql).not.toMatch(/set[\s\S]{0,80}\brelationship_status\s*=/)
  })

  it('requires a reason, a non-empty expect, and a non-empty set', () => {
    expect(sql).toContain("coalesce(btrim(p_reason), '') = ''")
    expect(sql).toMatch(/p_expect is null or p_expect = '\{\}'::jsonb/)
    expect(sql).toMatch(/p_set is null or p_set = '\{\}'::jsonb/)
  })

  it('compares every expected value before writing', () => {
    expect(sql).toMatch(/to_jsonb\(v_before\) -> v_key is distinct from p_expect -> v_key/)
  })

  it('writes the audit row in the same function as the update', () => {
    expect(sql).toContain('insert into public.matter_activity')
    expect(sql).toContain("'matter_corrected'")
    // matter_activity.matter_id is text while matters.id is uuid.
    expect(sql).toContain('p_matter_id::text')
    const update = sql.indexOf('update public.matters set')
    const audit = sql.indexOf('insert into public.matter_activity')
    expect(update).toBeGreaterThan(-1)
    expect(audit).toBeGreaterThan(update)
  })

  it('is callable by the service role and by nobody else', () => {
    expect(sql).toContain('revoke all on function public.correct_matter(uuid, jsonb, jsonb, text) from public')
    expect(sql).toContain('grant execute on function public.correct_matter(uuid, jsonb, jsonb, text) to service_role')
    expect(sql).not.toMatch(/grant execute on function public\.correct_matter[^\n]*to authenticated/)
  })

  it('reloads PostgREST, which otherwise cannot resolve a brand-new function', () => {
    expect(sql).toContain("notify pgrst, 'reload schema'")
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/matters-mcp.test.ts`
Expected: FAIL — `ENOENT` on `supabase/migrations/20261118000000_correct_matter.sql`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261118000000_correct_matter.sql`:

```sql
-- One transaction that corrects a matter and records that it did.
--
-- PostgREST cannot run a multi-statement transaction, so a client that updates
-- `matters` and then inserts `matter_activity` can fail between the two and
-- leave a change nobody can trace. Three matters were renamed by hand on
-- 2026-09-09 and are in exactly that state: the old names survive only because
-- the archived identity tasks happen to quote them.
--
-- The guardrails are here rather than in the calling server so they hold for
-- every caller.

create or replace function public.correct_matter(
  p_matter_id uuid,
  p_expect jsonb,
  p_set jsonb,
  p_reason text
)
returns public.matters
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_before public.matters;
  v_after public.matters;
  v_key text;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is required: it is the only record of why this changed';
  end if;

  -- Both must be non-empty here, not only in the caller. An empty p_set is a
  -- write that reports success and changes nothing; an empty p_expect is the
  -- concurrency check silently opting itself out.
  if p_set is null or p_set = '{}'::jsonb then
    raise exception 'Nothing to set';
  end if;
  if p_expect is null or p_expect = '{}'::jsonb then
    raise exception 'p_expect is required: state the value you read, so a stale read is refused rather than applied';
  end if;

  select * into v_before from public.matters where id = p_matter_id;
  if not found then
    raise exception 'No matter %', p_matter_id;
  end if;

  -- Only these three are corrigible. `stage` and `relationship_status` are
  -- absent by construction: they have validation triggers, they write history
  -- tables, and trg_matters_fire_stage_prompts enqueues real drafting runs on a
  -- stage change. An agent tripping that by accident is a far worse failure
  -- than a wrong title.
  for v_key in select jsonb_object_keys(p_set) loop
    if v_key not in ('name', 'matter_number', 'matter_type') then
      raise exception 'Field % cannot be corrected through this function', v_key;
    end if;
  end loop;

  -- Optimistic concurrency. The caller states what it believes it read; a
  -- mismatch means the read is stale and the write would clobber whatever
  -- changed in between.
  for v_key in select jsonb_object_keys(p_expect) loop
    if to_jsonb(v_before) -> v_key is distinct from p_expect -> v_key then
      raise exception 'Stale read on %: expected %, found %',
        v_key, p_expect -> v_key, to_jsonb(v_before) -> v_key;
    end if;
  end loop;

  -- coalesce means a key absent from p_set is left alone, and it also means
  -- this function cannot set a field to null. That is deliberate: clearing
  -- matter_number is not a correction, and a tool that could do it by omission
  -- would do it by accident.
  update public.matters set
    name          = coalesce(p_set ->> 'name', name),
    matter_number = coalesce(p_set ->> 'matter_number', matter_number),
    matter_type   = coalesce(p_set ->> 'matter_type', matter_type)
  where id = p_matter_id
  returning * into v_after;

  -- Same transaction as the update. This is the whole reason the correction is
  -- a function rather than two client calls.
  --
  -- matter_id is text on this table while matters.id is uuid, so the cast is
  -- required, not stylistic. RLS on matter_activity allows staff inserts only;
  -- a security definer function runs as owner and is not subject to it.
  --
  -- actor_id and actor_email stay null: an MCP call has no auth.uid(), and
  -- inventing one would be worse than an honest null beside the actor_name.
  insert into public.matter_activity (matter_id, event_type, actor_name, title, detail, metadata)
  values (
    p_matter_id::text,
    'matter_corrected',
    'matters-mcp',
    'Matter corrected',
    p_reason,
    jsonb_build_object(
      'before', (select jsonb_object_agg(k, to_jsonb(v_before) -> k) from jsonb_object_keys(p_set) k),
      'after',  (select jsonb_object_agg(k, to_jsonb(v_after)  -> k) from jsonb_object_keys(p_set) k)
    )
  );

  return v_after;
end;
$$;

comment on function public.correct_matter(uuid, jsonb, jsonb, text) is
  'Correct a matter''s name, matter_number or matter_type and record it in matter_activity, in one transaction. Refuses a stale p_expect, an empty p_set, an empty reason, and any field outside the three.';

-- The service role only. This bypasses RLS by design and must not be reachable
-- from a browser session.
revoke all on function public.correct_matter(uuid, jsonb, jsonb, text) from public;
revoke all on function public.correct_matter(uuid, jsonb, jsonb, text) from authenticated;
grant execute on function public.correct_matter(uuid, jsonb, jsonb, text) to service_role;

-- PostgREST resolves functions from a cached schema and will answer PGRST202
-- for a brand-new one until it reloads.
notify pgrst, 'reload schema';
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/matters-mcp.test.ts`
Expected: PASS, 23 tests.

- [ ] **Step 5: Prove the field guard is load-bearing**

Temporarily change `not in ('name', 'matter_number', 'matter_type')` to `not in ('name', 'matter_number', 'matter_type', 'stage')` and re-run:

```bash
npx vitest run tests/matters-mcp.test.ts
```

Expected: the `refuses every field except the three that are corrigible` test goes RED. Restore the line and re-run to confirm green. A guard whose test passes either way guards nothing.

- [ ] **Step 6: Commit the migration**

```bash
git add supabase/migrations/20261118000000_correct_matter.sql tests/matters-mcp.test.ts
git commit -m "correct_matter: the update and its audit row in one transaction

PostgREST cannot run a multi-statement transaction, so a client that
updates the matter and then writes the audit row can fail between them.
Three matters renamed by hand today are in exactly that state.

stage and relationship_status are absent by construction rather than
rejected by a check — a stage change fires trg_matters_fire_stage_prompts,
which enqueues real drafting runs.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Apply the migration and regenerate the types *(controller-only — not for a subagent)***

**This cannot be deferred to Task 6, and Task 5 will not compile without it.**
Measured on 2026-09-09: `SupabaseClient<Database>['rpc']` types its first
argument as a union of the generated function-name literals, so
`client.rpc('correct_matter', …)` is a **hard compile error** — not a silent
`any` — until `correct_matter` exists in
`packages/db-types/src/supabase.generated.ts`:

```
error TS2345: Argument of type '"correct_matter"' is not assignable to parameter of type
'"approve_invoice_reminder" | "assert_billing_actor" | … | "void_invoice"'.
```

CI forces the same order independently: `db-types-drift.yml` links the project,
regenerates, and fails on any diff, so the committed types must already
describe the applied function.

Apply it. The pooler is the only route from a worktree (`--linked` fails
because a worktree is never linked). Copy `.env.local` in only for the
operation and delete it immediately, including on failure. Never print, echo,
or log the password.

```bash
WT=$(pwd)
cp /Users/scottaubrey/Desktop/GitHub/cornerstone-drafting/.env.local "$WT/.env.local.tmp"
trap 'rm -f "$WT/.env.local.tmp"' EXIT INT TERM
PW=$(grep -m1 '^SUPABASE_DB_PASSWORD=' "$WT/.env.local.tmp" | cut -d= -f2- | tr -d '"')
PWE=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$PW")
D="postgresql://postgres.qifunlovuwaryzsyfbnh:${PWE}@aws-0-us-east-1.pooler.supabase.com:5432/postgres"
unset PW PWE
psql "$D" -v ON_ERROR_STOP=1 -f supabase/migrations/20261118000000_correct_matter.sql
```

Verify from the **catalog**, never from `supabase_migrations.schema_migrations`
— this project has had a migration recorded as applied whose body never ran:

```bash
psql "$D" -At -c "select proname, pg_get_function_identity_arguments(oid) from pg_proc where proname = 'correct_matter';"
```

Expected: `correct_matter|p_matter_id uuid, p_expect jsonb, p_set jsonb, p_reason text`

Then regenerate the types:

```bash
npx supabase gen types typescript --db-url "$D" --schema public > /tmp/regen.ts
```

**The trap:** `--linked` emits a leading `__InternalSupabase: { PostgrestVersion: … }`
block and `--db-url` does **not**. `tests/supabase-types-drift.test.ts` asserts
`PostgrestVersion:` is present, and `db-types-drift.yml` regenerates with
`--linked` — so a `--db-url` regeneration that drops it fails the test and would
report permanent drift. Re-add the block by hand, copying it verbatim from the
current `packages/db-types/src/supabase.generated.ts`, before overwriting that
file.

```bash
npm test -- tests/supabase-types-drift.test.ts
grep -c 'correct_matter' packages/db-types/src/supabase.generated.ts   # expect >= 1
npm run typecheck
```

- [ ] **Step 8: Commit the regenerated types**

```bash
git add packages/db-types/src/supabase.generated.ts
git commit -m "Regenerate the types for correct_matter

client.rpc() types its first argument as a union of generated function-name
literals, so the call Task 5 adds is a compile error until the function is
in here. CI's db-types-drift check forces the same order from the other
side.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `correctMatter` and the tool layer

**Files:**
- Modify: `tools/matters-mcp/src/matters.ts`
- Create: `tools/matters-mcp/src/tools.ts`
- Test: `tests/matters-mcp.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/matters-mcp.test.ts`:

Task 3 already imports from `../tools/matters-mcp/src/matters` at the top of this
file. **Merge `correctMatter` into that existing import** rather than adding a
second one from the same path, so the line reads
`import { correctMatter, getMatter, listMatters } from '../tools/matters-mcp/src/matters'`.
Then add the `tools` import:

```ts
import { CORRECT_MATTER_SHAPE } from '../tools/matters-mcp/src/tools'

function fakeRpcClient(result: { data: unknown; error: { message: string; code?: string } | null }) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  return {
    calls,
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args })
      return Promise.resolve(result)
    },
  }
}

describe('correctMatter', () => {
  it('calls the RPC with the parameter names the function declares', async () => {
    const client = fakeRpcClient({ data: { ...MATTER_ROW, name: 'Jie Cheng — Estate Planning' }, error: null })
    await correctMatter(client as never, {
      matterId: MATTER_ROW.id,
      expect: { name: 'Can Cheng — Estate Planning' },
      set: { name: 'Jie Cheng — Estate Planning' },
      reason: 'sheet and every contact say Jie Cheng',
    })
    expect(client.calls[0]).toEqual({
      name: 'correct_matter',
      args: {
        p_matter_id: MATTER_ROW.id,
        p_expect: { name: 'Can Cheng — Estate Planning' },
        p_set: { name: 'Jie Cheng — Estate Planning' },
        p_reason: 'sheet and every contact say Jie Cheng',
      },
    })
  })

  it('refuses an empty expect before the round trip', async () => {
    const client = fakeRpcClient({ data: null, error: null })
    await expect(
      correctMatter(client as never, {
        matterId: MATTER_ROW.id,
        expect: {},
        set: { name: 'x' },
        reason: 'r',
      }),
    ).rejects.toThrow(/expect/)
    // Refused locally, so the database was never asked.
    expect(client.calls).toEqual([])
  })

  it('refuses an empty set and an empty reason before the round trip', async () => {
    const client = fakeRpcClient({ data: null, error: null })
    await expect(
      correctMatter(client as never, { matterId: MATTER_ROW.id, expect: { name: 'a' }, set: {}, reason: 'r' }),
    ).rejects.toThrow(/set/)
    await expect(
      correctMatter(client as never, {
        matterId: MATTER_ROW.id,
        expect: { name: 'a' },
        set: { name: 'b' },
        reason: '   ',
      }),
    ).rejects.toThrow(/reason/)
    expect(client.calls).toEqual([])
  })

  it('explains a missing RPC as a deploy problem, not a bad argument', async () => {
    const client = fakeRpcClient({ data: null, error: { message: 'Not Found', code: 'PGRST202' } })
    await expect(
      correctMatter(client as never, {
        matterId: MATTER_ROW.id,
        expect: { name: 'a' },
        set: { name: 'b' },
        reason: 'r',
      }),
    ).rejects.toThrow(/correct_matter is not exposed/)
  })

  it('passes the database’s own refusal through verbatim', async () => {
    const client = fakeRpcClient({
      data: null,
      error: { message: 'Stale read on name: expected "A", found "B"' },
    })
    await expect(
      correctMatter(client as never, {
        matterId: MATTER_ROW.id,
        expect: { name: 'A' },
        set: { name: 'C' },
        reason: 'r',
      }),
    ).rejects.toThrow(/Stale read on name: expected "A", found "B"/)
  })
})

describe('the correct_matter tool shape', () => {
  it('accepts only the three corrigible fields, matching the function', () => {
    const parsed = CORRECT_MATTER_SHAPE.safeParse({
      matter_id: MATTER_ROW.id,
      expect: { stage: 'drafting' },
      set: { name: 'x' },
      reason: 'r',
    })
    expect(parsed.success).toBe(false)
  })

  it('accepts a well-formed correction', () => {
    expect(
      CORRECT_MATTER_SHAPE.safeParse({
        matter_id: MATTER_ROW.id,
        expect: { name: 'a' },
        set: { name: 'b' },
        reason: 'r',
      }).success,
    ).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/matters-mcp.test.ts`
Expected: FAIL — `correctMatter` is not exported and `../tools/matters-mcp/src/tools` cannot be found.

- [ ] **Step 3: Add `correctMatter` to `matters.ts`**

Append to `tools/matters-mcp/src/matters.ts`:

```ts
/** The only fields `correct_matter` will accept. Kept in step with the function. */
export const CORRIGIBLE_FIELDS = ['name', 'matter_number', 'matter_type'] as const
export type CorrigibleField = (typeof CORRIGIBLE_FIELDS)[number]
export type CorrigibleValues = Partial<Record<CorrigibleField, string>>

export interface CorrectMatterInput {
  matterId: string
  expect: CorrigibleValues
  set: CorrigibleValues
  reason: string
}

/**
 * Correct a matter through the RPC.
 *
 * The local checks below are duplicates of the function's own. They exist to
 * skip a round trip and to give a clearer message, never as the enforcement —
 * the database refuses these cases whoever calls it, which is the point of
 * putting them there.
 */
export async function correctMatter(client: MattersClient, input: CorrectMatterInput) {
  if (Object.keys(input.expect).length === 0) {
    throw new Error('expect is required: state the value you read, so a stale read is refused rather than applied')
  }
  if (Object.keys(input.set).length === 0) throw new Error('set is empty: nothing would change')
  if (input.reason.trim().length === 0) {
    throw new Error('reason is required: it is the only record of why this changed')
  }

  const { data, error } = await client.rpc('correct_matter', {
    p_matter_id: input.matterId,
    p_expect: input.expect,
    p_set: input.set,
    p_reason: input.reason,
  })

  if (error) {
    // PostgREST answers PGRST202 for a function it cannot resolve. That is a
    // deploy or schema-cache problem, not a bad argument, and this project has
    // had a migration recorded as applied whose body never ran.
    if (error.code === 'PGRST202') {
      throw new Error(
        'correct_matter is not exposed by PostgREST. Check pg_proc and the OpenAPI document — not supabase_migrations.schema_migrations, which has been wrong here before.',
      )
    }
    throw new Error(error.message)
  }

  return data
}
```

- [ ] **Step 4: Write the tool layer**

Create `tools/matters-mcp/src/tools.ts`:

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { MattersClient } from './client'
import { correctMatter, getMatter, listMatters } from './matters'

const corrigible = z
  .object({
    name: z.string().min(1).optional(),
    matter_number: z.string().min(1).optional(),
    matter_type: z.enum(['individual', 'couple']).optional(),
  })
  .strict()

/**
 * Exported so a test can assert the tool refuses a field the function refuses.
 * `.strict()` is what makes `{ stage: … }` a parse failure rather than a
 * silently dropped key.
 */
export const CORRECT_MATTER_SHAPE = z.object({
  matter_id: z.string().uuid(),
  expect: corrigible,
  set: corrigible,
  reason: z.string().min(1),
})

const asText = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] })

/** Every failure returns its reason as text. A silent no-op is the failure this design guards against. */
async function reporting(work: () => Promise<unknown>) {
  try {
    return asText(await work())
  } catch (error) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
    }
  }
}

export function registerTools(server: McpServer, client: MattersClient): void {
  server.tool(
    'list_matters',
    'List matters, optionally filtered by relationship status, stage, or a name substring.',
    {
      relationship_status: z.enum(['lead', 'hired', 'lost', 'declined']).optional(),
      stage: z.string().optional(),
      name_contains: z.string().optional(),
    },
    async (args) =>
      reporting(() =>
        listMatters(client, {
          relationshipStatus: args.relationship_status,
          stage: args.stage,
          nameContains: args.name_contains,
        }),
      ),
  )

  server.tool(
    'get_matter',
    'One matter with its latest design sheet and every linked contact — the three things that have to agree.',
    { matter_id: z.string().uuid() },
    async (args) => reporting(() => getMatter(client, args.matter_id)),
  )

  server.tool(
    'correct_matter',
    "Correct a matter's name, matter_number or matter_type. `expect` must carry the values you read; a stale read is refused. Stage and relationship status cannot be changed here.",
    CORRECT_MATTER_SHAPE.shape,
    async (args) =>
      reporting(() =>
        correctMatter(client, {
          matterId: args.matter_id,
          expect: args.expect,
          set: args.set,
          reason: args.reason,
        }),
      ),
  )
}
```

- [ ] **Step 5: Run the tests, typecheck, lint**

```bash
npx vitest run tests/matters-mcp.test.ts
npm run typecheck
npm run lint
```

Expected: PASS, 30 tests; typecheck and lint clean.

- [ ] **Step 6: Commit**

```bash
git add tools/matters-mcp/src/matters.ts tools/matters-mcp/src/tools.ts tests/matters-mcp.test.ts
git commit -m "The three tools, with expect required at both ends

The server's checks duplicate the function's on purpose: they skip a round
trip and read better, but the database is the enforcement. zod .strict() is
what makes a stage key a parse failure rather than a dropped one.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The entry point, the applied migration, and verification against the real database

**Files:**
- Create: `tools/matters-mcp/src/stdio.ts`
- Modify: `~/.claude.json` (not in the repository)

- [ ] **Step 1: Write the entry point**

Create `tools/matters-mcp/src/stdio.ts`:

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createMattersClient, mattersClientConfig } from './client'
import { registerTools } from './tools'

async function main(): Promise<void> {
  // Configuration first, so a missing key fails here with its own name rather
  // than on the first tool call.
  const client = createMattersClient(mattersClientConfig(process.env))

  const server = new McpServer({ name: 'cornerstone-matters', version: '0.1.0' })
  registerTools(server, client)

  await server.connect(new StdioServerTransport())
}

main().catch((error) => {
  // stdout is the transport. Diagnostics must go to stderr or they corrupt the
  // protocol stream.
  console.error(error)
  process.exit(1)
})
```

- [ ] **Step 2: Typecheck, lint, run the whole suite, commit**

```bash
npm run typecheck
npm run lint
npm test
git add tools/matters-mcp/src/stdio.ts
git commit -m "The stdio entry point

Configuration is resolved before the transport connects, so a missing key
fails with its own name. Diagnostics go to stderr because stdout is the
protocol stream.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Open the PR and merge it once green**

```bash
git push -u origin claude/matters-mcp
gh pr create --base main --title "A cornerstone-native matters MCP server" --body "Implements docs/superpowers/specs/2026-09-09-matters-mcp-design.md"
```

Wait for all four required checks to **appear and finish**, then merge. Do not read the absence of the word "pending" as completion — a check that has not registered yet looks identical to one that passed.

- [ ] **Step 4: Prove the behaviour inside a rolled-back transaction *(controller-only)***

The migration was already applied in Task 4 Step 7, because Task 5 could not
compile otherwise. Rebuild the connection string the same way (copy `.env.local`
in, `trap` its removal, never print the password) and use it below as `$D`.

Client data is privileged: this proves the rules without editing and restoring a real record. Every case below must be run **against the function directly**, not through the tool layer — a test that reaches these through the server would pass with the database enforcing nothing.

Pick any real matter id for `:mid`. Run each and record the outcome:

```sql
-- 1. A valid correction updates the row AND writes exactly one audit row.
begin;
select correct_matter(:'mid'::uuid,
  jsonb_build_object('name', (select name from public.matters where id = :'mid'::uuid)),
  '{"name":"ZZZ Test Rename"}'::jsonb, 'plan task 6 verification');
select name from public.matters where id = :'mid'::uuid;                          -- ZZZ Test Rename
select count(*), metadata from public.matter_activity
 where matter_id = :'mid' and event_type = 'matter_corrected' group by metadata;  -- 1, before/after present
rollback;

-- 2. A stale expect raises and changes nothing.
begin;
select correct_matter(:'mid'::uuid, '{"name":"Not The Current Name"}'::jsonb,
  '{"name":"X"}'::jsonb, 'r');                                                    -- ERROR: Stale read on name
rollback;

-- 3. An empty reason raises.
begin;
select correct_matter(:'mid'::uuid, '{"name":"x"}'::jsonb, '{"name":"y"}'::jsonb, '   ');
rollback;                                                                          -- ERROR: A reason is required

-- 4. An empty expect raises — the check cannot opt itself out.
begin;
select correct_matter(:'mid'::uuid, '{}'::jsonb, '{"name":"y"}'::jsonb, 'r');
rollback;                                                                          -- ERROR: p_expect is required

-- 5. An empty set raises rather than succeeding with nothing changed.
begin;
select correct_matter(:'mid'::uuid, '{"name":"x"}'::jsonb, '{}'::jsonb, 'r');
rollback;                                                                          -- ERROR: Nothing to set

-- 6. stage is unreachable, and unchanged.
begin;
select correct_matter(:'mid'::uuid,
  jsonb_build_object('name', (select name from public.matters where id = :'mid'::uuid)),
  '{"stage":"closed"}'::jsonb, 'r');                                              -- ERROR: Field stage cannot be corrected
rollback;

-- 7. An unknown matter raises.
begin;
select correct_matter('00000000-0000-0000-0000-000000000000'::uuid,
  '{"name":"x"}'::jsonb, '{"name":"y"}'::jsonb, 'r');                             -- ERROR: No matter 00000000-…
rollback;
```

**Report all seven outcomes.** If case 1 writes zero or two audit rows, or if any of 2–7 succeeds, stop and fix the function — those are the guarantees the whole design rests on.

- [ ] **Step 5: Point the MCP registration at the new server**

In `~/.claude.json`, replace the `aubreylaw-matters` entry under `mcpServers` with:

```json
"cornerstone-matters": {
  "type": "stdio",
  "command": "npx",
  "args": ["tsx", "/Users/scottaubrey/Desktop/GitHub/cornerstone-drafting/tools/matters-mcp/src/stdio.ts"],
  "env": {
    "SUPABASE_URL": "<the project URL from .env.local>",
    "SUPABASE_SERVICE_ROLE_KEY": "<the service role key from .env.local>"
  }
}
```

The path points at the **primary checkout**, not a worktree, so the registration survives the worktree being deleted.

Ask the user to copy the two values in themselves, or to confirm before you read them out of `.env.local` — they are credentials, and this file is not in the repository.

- [ ] **Step 6: Confirm the tools answer**

Restart the session so the server is picked up, then call `get_matter` on a matter with a known design sheet. It must return the matter, the latest sheet version, and the contacts in one response. Confirm `list_matters` with `relationship_status: "hired"` returns rows.

Report what came back.

---

## Verification against the spec

| spec requirement | task |
| --- | --- |
| new workspace `tools/matters-mcp`, `@aubrey-law/matters-mcp` | 1 |
| depends on `@aubrey-law/db-types` for typed access | 1, 2 |
| service key over PostgREST | 2 |
| `list_matters` with filters, capped | 3 |
| `get_matter` joins latest sheet + contacts | 3 |
| `relationship_type` reported verbatim | 3 |
| `correct_matter` RPC, security definer, pinned search_path | 4 |
| only `name`/`matter_number`/`matter_type` reachable | 4 |
| `p_expect` required and compared | 4 |
| non-empty reason, non-empty set, non-empty expect — in the function | 4 |
| audit row in the same transaction, uuid→text cast | 4 |
| cannot set a field to null | 4 |
| error text for stale read, unknown matter, disallowed field, CHECK, PGRST202 | 4, 5 |
| `tools/matters-mcp/src` added to `checkDbRpcs.mjs` SOURCE_DIRS | 1 |
| `tools/matters-mcp/src` added to the lint script | 2 (not 1 — see Task 1 Step 4) |
| tool-layer unit tests against a fake client | 3, 5 |
| migration applied + types regenerated | 4 (Steps 7–8) |
| RPC behaviour proven in a rolled-back transaction | 6 |
| out of scope: create, delete, contacts, stage/relationship transitions | not implemented anywhere |

**Deviation from the spec, deliberate:** the spec sketched tests in `tools/matters-mcp/tests/`. Root vitest collects `tests/**` only, so they live in `tests/matters-mcp.test.ts` instead. A test that never runs is worse than a test in a slightly odd place.
