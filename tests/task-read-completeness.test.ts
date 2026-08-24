import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { taskFixture } from './fixtures/task'
import { TASK_PAGE_SIZE, TASK_READ_CEILING, fetchTasks } from '@/lib/queries/tasks'

/**
 * Every task surface reads through one query, and that query had no `order`.
 * A PostgREST `limit` without one returns an arbitrary slice: with 1,024 open
 * tasks on 2026-08-24, a `limit(500)` was a coin flip over which half the
 * reader saw. §6a of docs/architecture-review-leads-crm.md has the numbers.
 *
 * These cover the two shapes the fix takes: read the whole thing in pages when
 * the surface means "all of it", and ask the database for the subset when it
 * does not.
 */

interface Call { method: string; args: unknown[] }
const calls: Call[] = []
let pages: unknown[][] = []
let pageIndex = 0

let leadMatterId: string | null = null

function builder() {
  const chain: Record<string, unknown> = {}
  // The lead-matter lookup ends in maybeSingle rather than a page read.
  chain.maybeSingle = () =>
    Promise.resolve({ data: leadMatterId ? { id: leadMatterId } : null, error: null })
  for (const method of ['select', 'in', 'eq', 'or', 'neq', 'is', 'not', 'ilikeAnyOf', 'order']) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args })
      return chain
    }
  }
  const resolve = (...args: unknown[]) => {
    calls.push({ method: 'read', args })
    const data = pages[pageIndex] ?? []
    pageIndex += 1
    return Promise.resolve({ data, error: null })
  }
  chain.limit = resolve
  chain.range = resolve
  return chain
}

vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({ from: () => builder() }),
}))

afterEach(() => {
  calls.length = 0
  pages = []
  pageIndex = 0
  leadMatterId = null
  vi.restoreAllMocks()
})

function page(size: number, prefix: string) {
  return Array.from({ length: size }, (_, index) => taskFixture({ id: `${prefix}-${index}` }))
}

const filters = (method: string) => calls.filter(call => call.method === method)

describe('reading every open task', () => {
  it('pages past the limit that used to define the answer', async () => {
    // 1,024 open tasks: two full pages and a short one.
    pages = [page(TASK_PAGE_SIZE, 'a'), page(TASK_PAGE_SIZE, 'b'), page(24, 'c')]

    const rows = await fetchTasks({ status: 'open', all: true })

    expect(rows).toHaveLength(1024)
    const reads = filters('read')
    expect(reads).toHaveLength(3)
    expect(reads[0]!.args).toEqual([0, TASK_PAGE_SIZE - 1])
    expect(reads[1]!.args).toEqual([TASK_PAGE_SIZE, TASK_PAGE_SIZE * 2 - 1])
  })

  it('stops on the short page rather than asking for one more', async () => {
    pages = [page(3, 'only')]
    const rows = await fetchTasks({ status: 'open', all: true })
    expect(rows).toHaveLength(3)
    expect(filters('read')).toHaveLength(1)
  })

  it('orders the pages so they partition instead of overlapping', async () => {
    pages = [page(2, 'a')]
    await fetchTasks({ status: 'open', all: true })

    // By the stored due date, so a capped read keeps the most urgent rows —
    // and then by id, because effective_due_at is null on most tasks and a
    // partial order would let a row land on two pages or neither.
    const ordered = filters('order').map(call => call.args[0])
    expect(ordered).toEqual(['effective_due_at', 'id'])
  })

  it('orders the capped reads too — an unordered limit is the whole bug', async () => {
    pages = [page(5, 'a')]
    await fetchTasks({ status: 'open', limit: 5 })

    const ordered = filters('order')
    expect(ordered.map(call => call.args[0])).toEqual(['effective_due_at', 'id'])
    // Undated work sorts last: it is not urgent, and there are 831 of it.
    expect(ordered[0]!.args[1]).toEqual({ nullsFirst: false })
  })

  it('says so rather than returning a silently short list at the ceiling', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    // Every page full, for ever: the guard is what has to stop it.
    pages = Array.from({ length: TASK_READ_CEILING / TASK_PAGE_SIZE }, () => page(TASK_PAGE_SIZE, 'x'))

    const rows = await fetchTasks({ status: 'open', all: true })

    expect(rows).toHaveLength(TASK_READ_CEILING)
    expect(error.mock.calls.flat().join(' ')).toContain('incomplete')
  })
})

describe('reading a subset', () => {
  it('asks the database for the matters it is about', async () => {
    pages = [[]]
    await fetchTasks({ status: 'open', matterIds: ['matter-1', 'matter-2'], all: true })
    expect(filters('in').some(call => call.args[0] === 'matter_id')).toBe(true)
  })

  it('answers an empty matter list without a query', async () => {
    pages = [page(3, 'should-not-be-read')]
    expect(await fetchTasks({ status: 'open', matterIds: [] })).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('reads undated work through the three columns effectiveDueAt reads', async () => {
    pages = [[]]
    await fetchTasks({ status: 'open', undated: true, hasEstimate: true })

    const nulls = filters('is').map(call => call.args[0])
    expect(nulls).toEqual(expect.arrayContaining(['due_at', 'soft_due_at', 'hard_due_at']))
    expect(filters('not').some(call => call.args[0] === 'estimate_minutes')).toBe(true)
  })

  it('matches titles with one filter, leaving the single or= to recordId', async () => {
    pages = [[]]
    await fetchTasks({ status: 'open', titleLike: ['follow', 'call'] })

    // Two `or=` parameters on one request collide; `ilikeAnyOf` is one filter.
    expect(filters('or')).toHaveLength(0)
    const ilike = filters('ilikeAnyOf')[0]
    expect(ilike?.args).toEqual(['title', ['%follow%', '%call%']])
  })
})

describe('reading one record', () => {
  it('reaches the matter a lead\'s plan actually hangs off', async () => {
    // `ensure_lead_matter` gives every lead a matters row, and the plan is
    // generated against it — so those tasks carry the matter's id, not the
    // intake id the lead is known by. Filtering on the intake id alone matched
    // nothing: on 2026-08-24 the lead Tasks tab and its badge read zero on
    // records holding 43 open tasks each.
    leadMatterId = 'matter-of-the-lead'
    pages = [[]]
    await fetchTasks({ status: 'open', recordId: '11111111-2222-3333-4444-555555555555' })

    const or = filters('or')[0]
    expect(or?.args[0]).toContain('matter_id.eq.matter-of-the-lead')
    // The intake id stays in the filter: a hand-added lead task carries it as
    // `lead_id`, and closeout has always matched both.
    expect(or?.args[0]).toContain('lead_id.eq.11111111-2222-3333-4444-555555555555')
  })

  it('asks for a record that is a matter without inventing a second clause', async () => {
    leadMatterId = null
    pages = [[]]
    await fetchTasks({ status: 'open', recordId: '11111111-2222-3333-4444-555555555555' })

    const or = filters('or')[0]
    expect(String(or?.args[0]).split(',')).toHaveLength(2)
  })

  it('refuses a record id that is not an id, rather than interpolating it', async () => {
    // The clauses go into a PostgREST filter string by interpolation.
    pages = [page(3, 'never-read')]
    expect(await fetchTasks({ status: 'open', recordId: 'not-a-uuid' })).toEqual([])
    expect(calls).toHaveLength(0)
  })
})

describe('the surfaces that used to slice', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

  // Each of these read an arbitrary 500 (or 1,000) of every open task and
  // filtered the result in JavaScript. None may go back to it.
  const SURFACES = [
    'app/admin/tasks/page.tsx',
    'lib/calendarAttention.ts',
    'app/api/cron/calendar-week-review/route.ts',
    'lib/adminChat/calendarTools.ts',
    'app/api/admin/calendar/plan/route.ts',
  ]

  it.each(SURFACES)('%s does not cap a whole-table read', file => {
    const source = read(file)
    const capped = source.match(/fetchTasks\(\{[^}]*status: 'open'[^}]*limit:[^}]*\}\)/g) ?? []
    // A record-scoped read is bounded by the record, not by the cap.
    expect(capped.filter(call => !call.includes('recordId'))).toEqual([])
  })
})
