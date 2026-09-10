import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mattersClientConfig } from '../tools/matters-mcp/src/client'
import { getMatter, listMatters } from '../tools/matters-mcp/src/matters'

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

  it('is linted, since the lint script names its directories', () => {
    expect(readJson('package.json').scripts.lint).toContain('tools/matters-mcp/src')
  })
})

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
