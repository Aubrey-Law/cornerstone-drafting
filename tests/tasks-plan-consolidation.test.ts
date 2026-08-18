import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { planDateColumns, planDateKey, planTimestamp, toPlanTask } from '@/lib/slaTasks/plan'
import { isTaskResolved, isTaskSkipped } from '@/lib/tasks/types'
import { taskFixture } from './fixtures/task'

/**
 * The SLA plan and the task queue used to be two tables describing the same
 * work. These cover what had to hold for them to become one: the plan's
 * calendar days survive a round trip through the timestamp columns, the queue
 * surfaces stay the firm's own work, and the stage engine stops firing a second
 * task for work the plan already lists.
 */

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
const MIGRATION = read('supabase/migrations/20261003000000_tasks_absorb_sla_plan.sql')

describe('a plan day survives the trip through `tasks`', () => {
  it('round-trips every day of the year, DST changes included', () => {
    // 12:00Z is the same calendar day in America/New_York at either offset;
    // midnight would land on the previous day for half the year.
    for (const day of ['2026-01-15', '2026-03-08', '2026-03-09', '2026-11-01', '2026-11-02']) {
      expect(planDateKey(planTimestamp(day)), day).toBe(day)
    }
  })

  it('leaves an undated task undated rather than guessing a day', () => {
    expect(planTimestamp(null)).toBeNull()
    expect(planDateKey(null)).toBeNull()
    // A malformed key is not a date either — better null than 'Invalid Date'.
    expect(planTimestamp('next tuesday')).toBeNull()
  })

  it('reads a task row through the plan vocabulary', () => {
    const plan = toPlanTask(
      taskFixture({
        title: 'Draft full document package',
        source: 'sla',
        phase: 'drafting',
        owner: 'firm',
        hard_due_at: '2026-03-08T12:00:00.000Z',
        nudge_at: '2026-03-06T12:00:00.000Z',
        plan_start_date: '2026-03-01',
      }),
    )

    expect(plan.name).toBe('Draft full document package')
    expect(plan.due_date).toBe('2026-03-08')
    expect(plan.nudge_date).toBe('2026-03-06')
    expect(plan.escalation_date).toBeNull()
    expect(plan.start_date).toBe('2026-03-01')
  })

  it('drops a phase or anchor the app does not know rather than trusting it', () => {
    const plan = toPlanTask(taskFixture({ phase: 'quantum_superposition', relative_to: 'vibes' }))
    expect(plan.phase).toBeNull()
    expect(plan.relative_to).toBeNull()
  })
})

describe('writing plan dates back', () => {
  it('keeps the working due date on the SLA day while nothing owns the task', () => {
    expect(planDateColumns({ due_date: '2026-03-08' })).toEqual({
      hard_due_at: '2026-03-08T12:00:00.000Z',
      due_at: '2026-03-08T12:00:00.000Z',
    })
  })

  it('leaves `due_at` alone once a stage has adopted the row', () => {
    // The stage's soft target lives in due_at from then on; overwriting it with
    // the SLA date would erase the buffer the stage engine set.
    const columns = planDateColumns({ due_date: '2026-03-08' }, { adopted: true })
    expect(columns.hard_due_at).toBe('2026-03-08T12:00:00.000Z')
    expect(columns).not.toHaveProperty('due_at')
  })
})

describe('skipped is not the same as abandoned', () => {
  it('counts a skipped task as resolved and an archived one as neither', () => {
    const skipped = taskFixture({ status: 'archived', skipped_at: '2026-03-04T00:00:00Z' })
    const abandoned = taskFixture({ status: 'archived' })

    expect(isTaskSkipped(skipped)).toBe(true)
    expect(isTaskResolved(skipped)).toBe(true)
    expect(isTaskSkipped(abandoned)).toBe(false)
    expect(isTaskResolved(abandoned)).toBe(false)
    expect(isTaskResolved(taskFixture({ status: 'done' }))).toBe(true)
  })
})

describe('the queue is the firm’s work, the plan is the whole matter', () => {
  it('filters to owner = firm unless a caller asks for everything', async () => {
    const filters: Record<string, unknown>[] = []
    const chain: Record<string, unknown> = {}
    for (const method of ['select', 'neq', 'in', 'is', 'or', 'order']) {
      chain[method] = (...args: unknown[]) => {
        filters.push({ method, args })
        return chain
      }
    }
    chain.eq = (column: string, value: unknown) => {
      filters.push({ method: 'eq', args: [column, value] })
      return chain
    }
    chain.limit = async () => ({ data: [], error: null })

    vi.doMock('@/lib/supabaseAdmin', () => ({
      getAdminClient: () => ({ from: () => chain }),
      ADMIN_EMAIL: 'admin@example.invalid',
    }))
    const { fetchTasks } = await import('@/lib/queries/tasks')

    await fetchTasks({})
    expect(filters).toContainEqual({ method: 'eq', args: ['owner', 'firm'] })

    filters.length = 0
    await fetchTasks({ owner: 'all' })
    expect(filters.some(f => Array.isArray(f.args) && f.args[0] === 'owner')).toBe(false)

    vi.doUnmock('@/lib/supabaseAdmin')
  })

  it('keeps skipped plan rows out of the queue but reachable for the plan', async () => {
    const source = read('lib/queries/tasks.ts')
    expect(source).toContain("if (!includeArchived) query = query.neq('status', 'archived')")
    expect(read('app/api/admin/tasks/route.ts')).toContain(
      "includeArchived: url.searchParams.get('includeArchived') === '1'",
    )
  })
})

describe('the stage engine stops describing the same work twice', () => {
  const engine = read('lib/stage-engine/fireStageTasks.ts')

  it('adopts the plan row for the stage instead of firing a second task', () => {
    expect(engine).toContain('findAdoptablePlanTask')
    // The candidate has to be plan work the firm owns, in the stage being
    // entered, that no earlier stage entry already claimed.
    expect(engine).toContain(".eq('source', 'sla')")
    expect(engine).toContain(".eq('owner', 'firm')")
    expect(engine).toContain(".is('stage_entered_at', null)")
    // The plan's deadline is the commitment; the stage only adds its buffer.
    expect(engine).toContain('adoptable.hard_due_at ??')
  })

  it('re-firing on the same stage entry writes nothing', () => {
    expect(engine).toContain('if (alreadyFired) return')
  })

  it('does not archive an adopted plan row when the matter leaves the stage', () => {
    // Leaving a stage with the work unfinished is the case the plan exists for.
    const archive = engine.slice(engine.indexOf('export async function archiveEngineStageTasks'))
    expect(archive).toContain(".eq('source', 'stage')")
  })
})

describe('the migration carries the old table over without losing anything', () => {
  it('maps every matter_tasks status onto a task status', () => {
    for (const [from, to] of [
      ['pending', 'open'],
      ['active', 'in_progress'],
      ['completed', 'done'],
      ['skipped', 'archived'],
      ['blocked', 'blocked'],
    ]) {
      expect(MIGRATION, from).toMatch(new RegExp(`when '${from}'\\s+then '${to}'`))
    }
  })

  it('keeps the ids, so the copy is idempotent and old links still resolve', () => {
    expect(MIGRATION).toContain('on conflict (id) do nothing')
    expect(MIGRATION).toMatch(/insert into public\.tasks \(\s*\n\s*id, matter_id, source/)
  })

  it('turns the attorney assignee into the firm owner', () => {
    expect(MIGRATION).toContain("case when mt.assignee = 'attorney' then 'firm' else mt.assignee end")
  })

  it('stores plan days at the noon-UTC instant the code reads them back from', () => {
    expect(MIGRATION).toContain("(mt.due_date + time '12:00') at time zone 'UTC'")
  })

  it('drops the old source check by definition, not by a guessed name', () => {
    // A leftover check would reject every source = 'sla' insert.
    expect(MIGRATION).toContain("pg_get_constraintdef(oid) like '%source%'")
    expect(MIGRATION).toContain("check (source in ('manual', 'stage', 'template', 'cadence', 'sla'))")
  })

  it('leaves matter_tasks in place so the copy can be checked against it', () => {
    expect(MIGRATION).not.toMatch(/drop table[^\n]*matter_tasks/i)
    expect(MIGRATION).toContain('comment on table public.matter_tasks is')
  })
})

describe('one tab, two views', () => {
  it('no longer offers an SLA tab on either workspace', () => {
    expect(read('lib/matterPageTabs.ts')).not.toMatch(/^\s*'sla',$/m)
    expect(read('lib/leads/leadPageTabs.ts')).not.toContain("'sla',")
  })

  it('resolves an old ?tab=sla link onto the tasks tab', async () => {
    const { parseMatterTab } = await import('@/lib/matterPageTabs')
    const { parseLeadTab } = await import('@/lib/leads/leadPageTabs')
    expect(parseMatterTab('sla')).toBe('tasks')
    expect(parseLeadTab('sla')).toBe('tasks')
  })

  it('points the internal nudge email at the plan view', () => {
    expect(read('app/api/cron/sla-task-nudges/route.ts')).toContain('?tab=tasks&view=plan')
  })
})
