import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  CLOSEOUT_REASONS,
  archiveTasksForClosedRecord,
  restoreTasksForReopenedRecord,
} from '@/lib/tasks/closeout'
import {
  POST_ENGAGEMENT_PHASES,
  SLA_PHASES,
  isPreEngagementPhase,
} from '@/lib/slaTasks/types'

/**
 * A lead was generated the whole 48-task estate-planning checklist on the day
 * it was created, including drafting, signing, funding and post-execution work
 * for a plan nobody had bought. On 2026-08-24 that put 709 post-engagement
 * tasks across 39 leads into the firm queue — 24 of them carrying
 * post-execution work — which is most of what the Today queue and the Tasks
 * page were holding.
 *
 * The plan is still generated whole, and the unsold half is archived behind
 * `not_engaged` so conversion is a restore rather than a second generation.
 * These pin the boundary, the sweep's reach, and the two things that would
 * quietly ruin it: sweeping a hand-added task, and a restore that revives more
 * than it held back.
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin = () => client() as any

beforeEach(() => {
  calls = []
  updateResult = { data: [{ id: 'task-1' }], error: null }
})

const taskCall = () => calls.find(call => call.table === 'tasks')!
const filter = (op: string) => taskCall().filters.filter(entry => entry.op === op)

describe('where the engagement boundary falls', () => {
  it('puts the lead stages before it and the matter stages after', () => {
    for (const phase of ['new_lead', 'intake_sent', 'intake_completed', 'engagement_sent']) {
      expect(isPreEngagementPhase(phase), phase).toBe(true)
      expect(POST_ENGAGEMENT_PHASES).not.toContain(phase)
    }
    // `intake` is the first stage a signed engagement reaches.
    for (const phase of ['intake', 'design', 'drafting', 'signing_scheduled', 'funding', 'closed']) {
      expect(isPreEngagementPhase(phase), phase).toBe(false)
      expect(POST_ENGAGEMENT_PHASES, phase).toContain(phase)
    }
    // Between them they are the whole vocabulary — a phase cannot be neither.
    expect(POST_ENGAGEMENT_PHASES.length + 4).toBe(SLA_PHASES.length)
  })

  it('treats an unphased task as neither, so a hand-added one is never swept', () => {
    // The sweep matches `phase in (…)`, and a task somebody typed has no phase.
    expect(isPreEngagementPhase(null)).toBe(false)
    expect(isPreEngagementPhase(undefined)).toBe(false)
    expect(isPreEngagementPhase('')).toBe(false)
    expect(POST_ENGAGEMENT_PHASES).not.toContain('')
  })
})

describe('holding the unsold half back', () => {
  it('is a reason the database will accept', () => {
    const migration = readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20261017000000_task_not_engaged_closeout.sql'),
      'utf8',
    )
    expect(CLOSEOUT_REASONS).toContain('not_engaged')
    // The migration redefines the whole CHECK rather than appending to it, so
    // it has to carry the reasons that were already there.
    // tests/task-closeout.test.ts holds the union to the current definition.
    expect(migration).toContain("'not_engaged'")
    expect(migration).toContain("'matter_closed'")
  })

  it('archives only the phases it was given', async () => {
    await archiveTasksForClosedRecord(
      admin(),
      { matterId: 'matter-1' },
      'not_engaged',
      {},
      { phases: POST_ENGAGEMENT_PHASES, logActivity: false },
    )

    expect(taskCall().update).toMatchObject({ status: 'archived', closeout_reason: 'not_engaged' })
    const phases = filter('in').find(entry => entry.args[0] === 'phase')
    expect(phases?.args[1]).toEqual(POST_ENGAGEMENT_PHASES)
    // Still only open work: a finished pre-engagement task stays finished.
    expect(filter('in').some(entry => entry.args[0] === 'status')).toBe(true)
  })

  it('sweeps everything when no phases are named, as the closeout paths do', async () => {
    await archiveTasksForClosedRecord(admin(), { matterId: 'matter-1' }, 'lead_lost', {}, { logActivity: false })
    expect(filter('in').some(entry => entry.args[0] === 'phase')).toBe(false)
  })
})

describe('releasing it at conversion', () => {
  it('restores only what the hold-back archived', async () => {
    await restoreTasksForReopenedRecord(
      admin(),
      { matterId: 'matter-1' },
      {},
      { reason: 'not_engaged', logActivity: false },
    )

    expect(taskCall().update).toMatchObject({ status: 'open', closeout_reason: null })
    expect(filter('eq').some(e => e.args[0] === 'closeout_reason' && e.args[1] === 'not_engaged')).toBe(true)
    // Not "anything a sweep touched": converting a lead that had gone lost must
    // not also revive the checklist the lost sweep archived.
    expect(filter('not').some(entry => entry.args[0] === 'closeout_reason')).toBe(false)
  })

  it('still restores every marked row when no reason is named', async () => {
    await restoreTasksForReopenedRecord(admin(), { matterId: 'matter-1' }, {}, { logActivity: false })
    expect(filter('not').some(entry => entry.args[0] === 'closeout_reason')).toBe(true)
    expect(filter('eq').some(entry => entry.args[0] === 'closeout_reason')).toBe(false)
  })
})
