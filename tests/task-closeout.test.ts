import { readFileSync, readdirSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  CLOSEOUT_REASONS,
  archiveTasksForClosedRecord,
  restoreTasksForReopenedRecord,
} from '@/lib/tasks/closeout'

/**
 * Closing a matter, or losing a lead, used to leave its whole checklist in the
 * firm queue forever — there was no way to clear it short of deleting rows one
 * at a time. The sweep archives what is still open, keeps what was finished,
 * and marks what it touched so reopening the record can put it back.
 *
 * The tests below pin the parts that are easy to get quietly wrong: which
 * statuses it writes over, which rows the restore is allowed to see, and the
 * fact that a completed task is never in either set.
 */

interface Call {
  table: string
  update?: Record<string, unknown>
  insert?: Record<string, unknown>
  filters: Array<{ op: string; args: unknown[] }>
}

let calls: Call[] = []
let updateResult: { data: unknown[] | null; error: { message: string } | null }

function client() {
  return {
    from(table: string) {
      const call: Call = { table, filters: [] }
      const chain: Record<string, unknown> = {}
      for (const op of ['in', 'or', 'eq', 'not', 'is']) {
        chain[op] = (...args: unknown[]) => {
          call.filters.push({ op, args })
          return chain
        }
      }
      chain.update = (values: Record<string, unknown>) => {
        call.update = values
        calls.push(call)
        return chain
      }
      chain.insert = async (values: Record<string, unknown>) => {
        call.insert = values
        calls.push(call)
        return { data: null, error: null }
      }
      chain.select = async () => updateResult
      return chain
    },
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const admin = () => client() as any

const MATTER = '11111111-1111-4111-8111-111111111111'
const LEAD = '22222222-2222-4222-8222-222222222222'

function taskUpdate() {
  return calls.find(c => c.table === 'tasks' && c.update)
}

beforeEach(() => {
  calls = []
  updateResult = { data: [{ id: 't-1' }, { id: 't-2' }], error: null }
})

describe('archiving a dead record’s tasks', () => {
  it('rewrites only the statuses that mean work is outstanding', async () => {
    await archiveTasksForClosedRecord(admin(), { matterId: MATTER }, 'matter_closed')

    const statusFilter = taskUpdate()?.filters.find(f => f.op === 'in')
    expect(statusFilter?.args[0]).toBe('status')
    // `done` is the record of work performed and must survive the close;
    // `archived` is already out of the queue.
    expect(statusFilter?.args[1]).toEqual(['open', 'in_progress', 'blocked'])
  })

  it('marks the rows it archived so the reopen path can find them', async () => {
    await archiveTasksForClosedRecord(admin(), { matterId: MATTER }, 'lead_declined')

    expect(taskUpdate()?.update).toMatchObject({
      status: 'archived',
      closeout_reason: 'lead_declined',
    })
    expect(taskUpdate()?.update?.skipped_at).toEqual(expect.any(String))
  })

  it('matches a lead by both of the columns its tasks can hang off', async () => {
    await archiveTasksForClosedRecord(admin(), { matterId: MATTER, leadId: LEAD }, 'lead_lost')

    const or = taskUpdate()?.filters.find(f => f.op === 'or')
    expect(or?.args[0]).toBe(`matter_id.eq.${MATTER},lead_id.eq.${LEAD}`)
  })

  it('writes nothing when the record identifies no rows', async () => {
    const count = await archiveTasksForClosedRecord(admin(), {}, 'matter_closed')

    expect(count).toBe(0)
    expect(calls).toEqual([])
  })

  it('reports a failed sweep instead of throwing over a committed status change', async () => {
    updateResult = { data: null, error: { message: 'permission denied' } }

    await expect(
      archiveTasksForClosedRecord(admin(), { matterId: MATTER }, 'matter_closed'),
    ).resolves.toBeNull()
  })

  it('puts a lead’s entry on the lead timeline, not the matter’s', async () => {
    await archiveTasksForClosedRecord(admin(), { matterId: MATTER, leadId: LEAD }, 'lead_lost')

    expect(calls.filter(c => c.insert).map(c => c.table)).toEqual(['lead_activity'])
  })

  it('logs the count against the matter when there is no lead behind it', async () => {
    await archiveTasksForClosedRecord(admin(), { matterId: MATTER }, 'matter_closed')

    const activity = calls.find(c => c.table === 'matter_activity')
    expect(activity?.insert).toMatchObject({ matter_id: MATTER, event_type: 'status_changed' })
    expect(activity?.insert?.title).toBe('2 tasks archived')
  })

  it('stays off the timeline when the caller is backfilling history', async () => {
    await archiveTasksForClosedRecord(admin(), { matterId: MATTER }, 'matter_closed', {}, {
      logActivity: false,
    })

    expect(calls.filter(c => c.insert)).toEqual([])
  })

  it('says nothing when it found nothing to archive', async () => {
    updateResult = { data: [], error: null }

    const count = await archiveTasksForClosedRecord(admin(), { matterId: MATTER }, 'matter_closed')

    expect(count).toBe(0)
    expect(calls.filter(c => c.insert)).toEqual([])
  })
})

describe('restoring a reopened record’s tasks', () => {
  it('touches only what the sweep marked, leaving a hand-skipped task skipped', async () => {
    await restoreTasksForReopenedRecord(admin(), { matterId: MATTER })

    const marked = taskUpdate()?.filters.find(f => f.op === 'not')
    expect(marked?.args).toEqual(['closeout_reason', 'is', null])
  })

  it('puts back only the rows the sweep left archived', async () => {
    await restoreTasksForReopenedRecord(admin(), { matterId: MATTER })

    const statusFilter = taskUpdate()?.filters.find(f => f.op === 'eq' && f.args[0] === 'status')
    // A task the sweep archived can be finished by hand afterwards — the plan
    // board still shows archived rows — and the marker stays on it. Without
    // this filter the next reopen would drag that completed task back to open.
    expect(statusFilter?.args[1]).toBe('archived')
  })

  it('clears both the skip stamp and the marker on the way back', async () => {
    await restoreTasksForReopenedRecord(admin(), { matterId: MATTER })

    expect(taskUpdate()?.update).toMatchObject({
      status: 'open',
      skipped_at: null,
      closeout_reason: null,
    })
  })

  it('reaches a lead’s hand-added tasks as well as its plan', async () => {
    await restoreTasksForReopenedRecord(admin(), { matterId: MATTER, leadId: LEAD })

    const or = taskUpdate()?.filters.find(f => f.op === 'or')
    expect(or?.args[0]).toBe(`matter_id.eq.${MATTER},lead_id.eq.${LEAD}`)
  })
})

describe('where the sweep is wired in', () => {
  const matterRoute = readFileSync('app/api/admin/matters/[id]/status/route.ts', 'utf8')
  const leadRoute = readFileSync('app/api/admin/leads/[id]/route.ts', 'utf8')

  it('runs after the matter transition has committed, never before', () => {
    const rpc = matterRoute.indexOf("rpc('transition_matter_status_with_closeout'")
    const guard = matterRoute.indexOf('const code = error.code')
    // lastIndexOf, not indexOf: the import statement is the first occurrence.
    const sweep = matterRoute.lastIndexOf('archiveTasksForClosedRecord')
    expect(rpc).toBeGreaterThan(-1)
    // Sweeping before the error check would archive the checklist of a matter
    // whose status change was rejected.
    expect(sweep).toBeGreaterThan(guard)
  })

  it('archives on the two matter statuses that end the work', () => {
    expect(matterRoute).toMatch(
      /if \(status === 'closed' \|\| status === 'archived'\) \{\s*await archiveTasksForClosedRecord\(admin, \{ matterId \}, 'matter_closed', actor\)/,
    )
  })

  it('restores when the matter goes active again, and leaves a hold alone', () => {
    expect(matterRoute).toMatch(
      /\} else if \(status === 'active'\) \{\s*await restoreTasksForReopenedRecord\(admin, \{ matterId \}, actor\)/,
    )
    // A matter on hold is still going somewhere; its plan waits with it.
    expect(matterRoute).not.toMatch(/'on_hold'.*archiveTasksForClosedRecord/)
  })

  it('maps each dead lead status to its own reason', () => {
    expect(leadRoute).toContain("lost: 'lead_lost'")
    expect(leadRoute).toContain("declined: 'lead_declined'")
  })

  it('restores a lead that is put back in play', () => {
    expect(leadRoute).toContain(
      "else if (status === 'lead') await restoreTasksForReopenedRecord(admin, target, actor)",
    )
  })

  it('leaves a converting lead’s checklist alone', () => {
    // `hired` is the one status that keeps its tasks: the matter it converts
    // into is the same row the plan was generated against.
    expect(leadRoute).not.toContain("hired: 'lead_")
    expect(leadRoute).toContain('if (!requestedHired) {')
  })

  it('sweeps the lead’s matter as well as the lead itself', () => {
    // The generated plan hangs off the matter behind the opportunity, so a
    // sweep keyed on the intake id alone would archive almost nothing.
    expect(leadRoute).toContain('const target = { leadId, matterId }')
  })
})

describe('what the plan view calls a closed-out row', () => {
  const view = readFileSync('components/tasks/TaskPlanView.tsx', 'utf8')

  it('does not call it skipped, which nobody chose', () => {
    expect(view).toContain("task.closeout_reason ? 'closed out' : 'skipped'")
  })

  it('says which event dropped it', () => {
    expect(view).toContain("reason === 'matter_closed'")
    expect(view).toContain("reason === 'lead_lost'")
    expect(view).toContain("reason === 'lead_declined'")
  })
})

describe('a task the user takes back by hand', () => {
  const route = readFileSync('app/api/matters/[matterId]/tasks/[taskId]/route.ts', 'utf8')

  it('loses the marker, so a later reopen cannot drag it back', () => {
    // Without this a task reopened and then completed still carries the
    // marker, and the next restore flips a done task back to open.
    expect(route).toMatch(/skipped_at: skipped \? now : null,[\s\S]{0,400}?closeout_reason: null,/)
  })

  it('loses it on the pause path too', () => {
    expect(route).toMatch(/update\.skipped_at = null\s*\n\s*update\.closeout_reason = null/)
  })
})

describe('the closeout reasons', () => {
  /**
   * The CHECK is redefined whenever a reason is added — 20261017000000 added
   * `not_engaged` — so this reads the last migration that defines it rather
   * than the one that introduced it. Pinning the original file passed until
   * the constraint moved on, and then failed for the wrong reason.
   */
  const migration = (() => {
    const dir = 'supabase/migrations'
    const defining = readdirSync(dir)
      .filter(file => file.endsWith('.sql'))
      .sort()
      .filter(file => readFileSync(`${dir}/${file}`, 'utf8').includes('add constraint tasks_closeout_reason_check'))
    expect(defining.length).toBeGreaterThan(0)
    return readFileSync(`${dir}/${defining[defining.length - 1]}`, 'utf8')
  })()

  it('are the same set the database will accept', () => {
    for (const reason of CLOSEOUT_REASONS) {
      expect(migration).toContain(`'${reason}'`)
    }
  })

  it('leave the column nullable so an untouched task carries no reason', () => {
    expect(migration).toMatch(/closeout_reason is null or closeout_reason in/)
  })
})
