import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectiveDueAt, taskDueGroup } from '@/lib/tasks/types'
import { taskFixture } from './fixtures/task'
// Static: vi.mock is hoisted above it, so the module under test sees the stub.
import { DUE_TASK_LIMIT, dueTaskFilter, fetchDueTasks } from '@/lib/queries/tasks'

/**
 * The Today queue read an unordered `limit(500)` over every open task and
 * picked the due ones out in JavaScript. On 2026-08-24 the firm had 1,024 open
 * tasks and 27 overdue; the first 500 rows in heap order contained **one** of
 * them, so the page said "1 task overdue" while the nav badge — which counts
 * through a 2,000-row read — said 27.
 *
 * These cover the fix: the due window is a filter, not a slice.
 */

const calls: Array<{ method: string; args: unknown[] }> = []

function builder(rows: unknown[]) {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'in', 'eq', 'or', 'neq', 'is']) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args })
      return chain
    }
  }
  chain.limit = (...args: unknown[]) => {
    calls.push({ method: 'limit', args })
    return Promise.resolve({ data: rows, error: null })
  }
  return chain
}

let tableRows: Record<string, unknown[]> = {}

vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({
    from: (table: string) => builder(tableRows[table] ?? []),
  }),
}))


afterEach(() => {
  calls.length = 0
  tableRows = {}
  vi.restoreAllMocks()
})

type DueColumns = Record<'due_at' | 'soft_due_at' | 'hard_due_at', string | null>

/** Split on commas that are not inside an `and(...)` group. */
function splitTerms(filter: string): string[] {
  const terms: string[] = []
  let depth = 0
  let current = ''
  for (const character of filter) {
    if (character === '(') depth += 1
    if (character === ')') depth -= 1
    if (character === ',' && depth === 0) {
      terms.push(current)
      current = ''
      continue
    }
    current += character
  }
  if (current) terms.push(current)
  return terms
}

/** Enough of PostgREST's filter grammar to run the one predicate under test. */
function evaluatePostgrestOr(filter: string, row: DueColumns): boolean {
  return splitTerms(filter).some(term => {
    if (term.startsWith('and(')) {
      return splitTerms(term.slice(4, -1)).every(inner => evaluateCondition(inner, row))
    }
    return evaluateCondition(term, row)
  })
}

function evaluateCondition(condition: string, row: DueColumns): boolean {
  const [column, operator, ...rest] = condition.split('.')
  const value = row[column as keyof DueColumns]
  const operand = rest.join('.')
  if (operator === 'is' && operand === 'null') return value === null
  if (operator === 'lte') return value !== null && value <= operand
  throw new Error(`unhandled PostgREST condition: ${condition}`)
}

const THROUGH = '2026-08-25T06:00:00.000Z'

describe('the due-task filter', () => {
  it('reads the three date columns in effectiveDueAt order of precedence', () => {
    expect(dueTaskFilter(THROUGH)).toBe(
      [
        `due_at.lte.${THROUGH}`,
        `and(due_at.is.null,soft_due_at.lte.${THROUGH})`,
        `and(due_at.is.null,soft_due_at.is.null,hard_due_at.lte.${THROUGH})`,
      ].join(','),
    )
  })

  it('selects exactly the rows effectiveDueAt puts inside the window', () => {
    // Evaluated from the filter string itself rather than from a second copy
    // of the rule: a test that restates the branches would agree with any
    // wrong version of them. Every combination of the three columns being
    // inside the window, outside it, or absent.
    const EARLY = '2026-08-20T12:00:00.000Z'
    const LATE = '2026-09-20T12:00:00.000Z'
    const values = [EARLY, LATE, null]

    for (const due_at of values) {
      for (const soft_due_at of values) {
        for (const hard_due_at of values) {
          const row = { due_at, soft_due_at, hard_due_at }
          const effective = effectiveDueAt(taskFixture(row))
          expect(evaluatePostgrestOr(dueTaskFilter(THROUGH), row), JSON.stringify(row)).toBe(
            effective !== null && effective <= THROUGH,
          )
        }
      }
    }
  })
})

describe('fetchDueTasks', () => {
  it('asks the database for the window instead of slicing an unordered read', async () => {
    tableRows = { tasks: [] }
    await fetchDueTasks(THROUGH)

    const or = calls.find(call => call.method === 'or')
    expect(or?.args[0]).toBe(dueTaskFilter(THROUGH))

    // The cap stays as a backstop, but it must sit far above the window it
    // bounds — the bug was a limit doing the filtering.
    const limit = calls.find(call => call.method === 'limit')
    expect(limit?.args[0]).toBe(DUE_TASK_LIMIT)
    expect(DUE_TASK_LIMIT).toBeGreaterThanOrEqual(500)

    // Only the firm's own work: a client's "sign the engagement" task belongs
    // to the plan board, not to the attorney's queue.
    expect(calls.some(call => call.method === 'eq' && call.args[0] === 'owner' && call.args[1] === 'firm')).toBe(true)
  })

  it('says so rather than silently returning a short queue at the cap', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    tableRows = {
      tasks: Array.from({ length: DUE_TASK_LIMIT }, (_, index) =>
        taskFixture({ id: `task-${index}`, due_at: '2026-08-20T12:00:00.000Z' }),
      ),
    }

    const rows = await fetchDueTasks(THROUGH)

    expect(rows).toHaveLength(DUE_TASK_LIMIT)
    expect(error.mock.calls.flat().join(' ')).toContain('incomplete')
  })

  it('returns every row it was given, soonest due first', async () => {
    tableRows = {
      tasks: [
        taskFixture({ id: 'later', due_at: '2026-08-24T12:00:00.000Z' }),
        taskFixture({ id: 'oldest', due_at: '2026-08-01T12:00:00.000Z' }),
        taskFixture({ id: 'middle', soft_due_at: '2026-08-10T12:00:00.000Z' }),
      ],
    }

    const rows = await fetchDueTasks(THROUGH)
    expect(rows.map(row => row.id)).toEqual(['oldest', 'middle', 'later'])
  })
})

describe('the grouping the queue does after the read', () => {
  it('drops what the wide boundary let through, and keeps what is due', () => {
    // The window ends 18 hours after firm noon, so it can include a task due
    // tomorrow. taskDueGroup is what decides, and it puts that task in neither
    // Today group.
    const now = new Date('2026-08-24T16:00:00.000Z')
    const overdue = taskFixture({ due_at: '2026-08-20T12:00:00.000Z' })
    const today = taskFixture({ due_at: '2026-08-24T18:00:00.000Z' })
    const tomorrow = taskFixture({ due_at: '2026-08-25T04:30:00.000Z' })

    expect(taskDueGroup(overdue, now)).toBe('overdue')
    expect(taskDueGroup(today, now)).toBe('today')
    expect(taskDueGroup(tomorrow, now)).not.toBe('overdue')
    expect(taskDueGroup(tomorrow, now)).not.toBe('today')
  })
})
