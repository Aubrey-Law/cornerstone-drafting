import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { effectiveDueAt } from '@/lib/tasks/types'
import { taskFixture } from './fixtures/task'

/**
 * `tasks.effective_due_at` (20261016000000) exists so the database can sort by
 * the value the app groups and sorts by. That only holds while the two read
 * the same three columns in the same order — the same reason
 * `tests/lead-score-sql-parity.test.ts` exists for `lead_score()`.
 *
 * A drift here would not throw. It would quietly order a queue by a different
 * date than the one shown next to each row.
 */

const MIGRATION = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20261016000000_task_effective_due.sql'),
  'utf8',
)

/** The columns a `coalesce(...)` in the migration names, in order. */
function coalesceColumns(sql: string): string[] {
  const match = sql.match(/generated always as \(\s*coalesce\(([^)]*)\)\s*\) stored/i)
  if (!match) throw new Error('no generated expression found in the migration')
  return match[1]!.split(',').map(column => column.trim())
}

describe('the stored due date and effectiveDueAt()', () => {
  it('reads the same columns in the same order of precedence', () => {
    const columns = coalesceColumns(MIGRATION)
    expect(columns).toEqual(['due_at', 'soft_due_at', 'hard_due_at'])

    // Derived from the function rather than asserted twice: each column in turn
    // is the only one set, and the value it yields says where it sits.
    const precedence = columns.map(column =>
      effectiveDueAt(taskFixture({
        due_at: null,
        soft_due_at: null,
        hard_due_at: null,
        [column]: `2026-08-0${columns.indexOf(column) + 1}T12:00:00.000Z`,
      } as Parameters<typeof taskFixture>[0])),
    )
    expect(precedence).toEqual([
      '2026-08-01T12:00:00.000Z',
      '2026-08-02T12:00:00.000Z',
      '2026-08-03T12:00:00.000Z',
    ])

    // And the order itself: an earlier column wins over a later one that is set.
    expect(effectiveDueAt(taskFixture({
      due_at: '2026-08-01T12:00:00.000Z',
      soft_due_at: '2026-07-01T12:00:00.000Z',
      hard_due_at: '2026-06-01T12:00:00.000Z',
    }))).toBe('2026-08-01T12:00:00.000Z')
    expect(effectiveDueAt(taskFixture({
      due_at: null,
      soft_due_at: '2026-07-01T12:00:00.000Z',
      hard_due_at: '2026-06-01T12:00:00.000Z',
    }))).toBe('2026-07-01T12:00:00.000Z')
  })

  it('is undated when all three are, the way coalesce is', () => {
    expect(effectiveDueAt(taskFixture({ due_at: null, soft_due_at: null, hard_due_at: null }))).toBeNull()
  })

  it('is stored and generated, so nothing can write a different value into it', () => {
    // A virtual column could not be indexed, and a plain column would need a
    // trigger and could drift.
    expect(MIGRATION).toMatch(/generated always as \([\s\S]*?\) stored/i)
    expect(MIGRATION).not.toMatch(/create trigger/i)
  })

  it('indexes the column the reads order by, under the filter they apply', () => {
    // `owner` leads because every queue read fixes it and takes a range of
    // statuses: a leading column under an inequality cannot order what follows.
    expect(MIGRATION).toMatch(
      /create index if not exists tasks_open_effective_due\s+on public\.tasks \(owner, effective_due_at\)\s+where status <> 'done'/i,
    )
    // The expression index it replaces would serve no read and cost every write.
    expect(MIGRATION).toMatch(/drop index if exists tasks_open_due/i)
  })
})
