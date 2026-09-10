import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mattersClientConfig } from '../tools/matters-mcp/src/client'
import { correctMatter, getMatter, listMatters } from '../tools/matters-mcp/src/matters'
import { CORRECT_MATTER_SHAPE } from '../tools/matters-mcp/src/tools'

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
function fakeClient(
  byTable: Record<string, { data: unknown; error: { message: string } | null; count?: number }>,
) {
  const calls: Array<{
    table: string
    filters: Array<[string, unknown]>
    order: string | null
    limit: number | null
  }> = []
  return {
    calls,
    from(table: string) {
      const record = {
        table,
        filters: [] as Array<[string, unknown]>,
        order: null as string | null,
        limit: null as number | null,
      }
      calls.push(record)
      const result = byTable[table] ?? { data: [], error: null }
      const chain: Record<string, unknown> = {
        select: () => chain,
        order: (column: string) => {
          record.order = column
          return chain
        },
        limit: (n: number) => {
          record.limit = n
          return chain
        },
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

  it('asks for name order', async () => {
    const client = fakeClient({ matters: { data: [], error: null } })
    await listMatters(client as never, {})
    expect(client.calls[0].order).toBe('name')
  })

  it('caps the result at 100 rows', async () => {
    const client = fakeClient({ matters: { data: [], error: null } })
    await listMatters(client as never, {})
    expect(client.calls[0].limit).toBe(100)
  })

  it('reports the total so a truncated answer is not mistaken for a complete one', async () => {
    // 100 rows back and 137 in the table: without `total` the caller cannot
    // tell a capped list from the whole practice.
    const rows = Array.from({ length: 100 }, (_, i) => ({
      id: `id-${i}`,
      name: `Matter ${i}`,
      matter_number: null,
      stage: 'drafting',
      relationship_status: 'hired',
    }))
    const client = fakeClient({ matters: { data: rows, error: null, count: 137 } })
    const result = await listMatters(client as never, {})
    expect(result.matters).toHaveLength(100)
    expect(result.total).toBe(137)
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

/**
 * The migration's SQL text.
 *
 * CI's test job gets no Supabase environment, so nothing here can call the
 * function. These assertions cover the structural facts that would be silently
 * wrong — the guardrails being present, the audit insert being in the same
 * statement block, the uuid-to-text cast — and the behaviour is verified by
 * hand against the real database in a rolled-back transaction later.
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

  /**
   * `anon` needs its own revoke, and this test exists because the first applied
   * version of this migration did not have one.
   *
   * Supabase ships a default privilege granting EXECUTE on every new function
   * in `public` to anon, authenticated and service_role. Revoking from `public`
   * does not touch those, because they are grants to named roles. Measured
   * against the live database on 2026-09-09 after the first apply:
   * `has_function_privilege('anon', …, 'EXECUTE')` was **true**.
   *
   * For a security definer function that bypasses RLS, that is worse than an
   * unauthorised write. The stale-read exception reports the current value, so
   * anyone holding the publishable key and a matter id could read that matter's
   * name by deliberately failing the check.
   */
  it('revokes anon explicitly, which revoking from public does not do', () => {
    expect(sql).toContain('revoke all on function public.correct_matter(uuid, jsonb, jsonb, text) from anon')
  })

  it('revokes every role Supabase grants by default before granting service_role', () => {
    // Order matters: a grant that precedes its revoke is undone by it.
    const grant = sql.indexOf('grant execute on function public.correct_matter(uuid, jsonb, jsonb, text) to service_role')
    for (const role of ['public', 'anon', 'authenticated']) {
      const revoke = sql.indexOf(`revoke all on function public.correct_matter(uuid, jsonb, jsonb, text) from ${role}`)
      expect(revoke).toBeGreaterThan(-1)
      expect(revoke).toBeLessThan(grant)
    }
  })

  it('reloads PostgREST, which otherwise cannot resolve a brand-new function', () => {
    expect(sql).toContain("notify pgrst, 'reload schema'")
  })
})

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
