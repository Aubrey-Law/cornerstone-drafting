import { beforeEach, describe, expect, it } from 'vitest'

import { generateMatterTasks } from '@/lib/slaTasks/generate'

/**
 * A lead and the matter it becomes run separate task lists cut from one
 * template. The lead list is generated when the lead is opened and ends at
 * "Client signs engagement agreement"; the matter list is generated at
 * conversion, beside a lead list that has usually been worked. These pin the
 * generator's side of that: each scope writes only its half, counts only its
 * half as "already generated", and a swap deletes only its half.
 */

const TEMPLATE_TASKS = [
  { phase: 'new_lead', name: 'Hold discovery call', due_offset_days: 0, relative_to: 'discovery_call', assignee: 'attorney', pre_engagement: true },
  { phase: 'engagement_sent', name: 'Client signs engagement agreement', due_offset_days: 4, relative_to: 'pmps', assignee: 'client', pre_engagement: true, triggers_day_zero: true },
  { phase: 'intake', name: 'Create matter folder in OneDrive', due_offset_days: 0, assignee: 'automation', auto: true },
  { phase: 'design', name: 'Client approves design', due_offset_days: 7, assignee: 'client' },
]

interface Op {
  table: string
  kind: 'select' | 'insert' | 'delete'
  filters: Array<[string, unknown[]]>
  rows?: Record<string, unknown>[]
}

let ops: Op[] = []
let existing: Record<string, unknown>[] = []

function fakeAdmin() {
  return {
    from(table: string) {
      const op: Op = { table, kind: 'select', filters: [] }
      const result = () => {
        if (table === 'matters') {
          return { data: { id: 'matter-1', discovery_call_at: null, pmps_at: null, engagement_signed_at: '2026-04-01T16:00:00Z', fit_decision: 'fit' }, error: null }
        }
        if (table === 'sla_task_templates') {
          return { data: { id: 'template-1', template_name: 'estate_planning_sla_v3', tasks: TEMPLATE_TASKS }, error: null }
        }
        if (op.kind === 'insert') {
          return { data: op.rows!.map((row, i) => ({ id: `new-${i}`, ...row })), error: null }
        }
        if (op.kind === 'delete') return { data: null, error: null }
        return { data: existing, error: null }
      }
      const chain: Record<string, unknown> = {}
      for (const name of ['select', 'eq', 'in', 'order']) {
        chain[name] = (...args: unknown[]) => {
          if (name !== 'select') op.filters.push([name, args])
          return chain
        }
      }
      chain.insert = (rows: Record<string, unknown>[]) => {
        op.kind = 'insert'
        op.rows = rows
        return chain
      }
      chain.delete = () => {
        op.kind = 'delete'
        return chain
      }
      chain.maybeSingle = async () => {
        ops.push(op)
        return result()
      }
      chain.then = (resolve: (value: unknown) => void, reject: (reason: unknown) => void) => {
        ops.push(op)
        return Promise.resolve(result()).then(resolve, reject)
      }
      return chain
    },
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin = () => fakeAdmin() as any
const inserted = () => ops.find(op => op.kind === 'insert')?.rows?.map(row => row.title) ?? []
const deletion = () => ops.find(op => op.kind === 'delete')

function existingTask(phase: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `${phase}-1`, title: phase, phase, status: 'done', source: 'sla', sort_order: 0,
    plan_template_id: 'template-1', completed_at: '2026-03-20T00:00:00Z', notes: null,
    skipped_at: null, paused_at: null, hard_due_at: null, due_at: null, nudge_at: null,
    escalation_at: null, ...overrides,
  }
}

beforeEach(() => {
  ops = []
  existing = []
})

describe('the lead list', () => {
  it('is only the work up to the engagement signature', async () => {
    const result = await generateMatterTasks(admin(), { matterId: 'matter-1', scope: 'lead' })
    expect(result.ok && result.created).toBe(true)
    expect(inserted()).toEqual(['Hold discovery call', 'Client signs engagement agreement'])
  })
})

describe('the matter list', () => {
  it('is generated beside a lead list that has already been worked', async () => {
    existing = [existingTask('new_lead'), existingTask('engagement_sent')]
    const result = await generateMatterTasks(admin(), { matterId: 'matter-1', scope: 'matter' })
    expect(result.ok && result.created).toBe(true)
    expect(inserted()).toEqual(['Create matter folder in OneDrive', 'Client approves design'])
    // Nothing on the lead list is removed to make room for it.
    expect(deletion()).toBeUndefined()
  })

  it('is dated from the engagement signature', async () => {
    await generateMatterTasks(admin(), { matterId: 'matter-1', scope: 'matter' })
    const rows = ops.find(op => op.kind === 'insert')!.rows!
    expect(rows.map(row => row.hard_due_at)).toEqual([
      '2026-04-01T12:00:00.000Z',
      '2026-04-08T12:00:00.000Z',
    ])
  })

  it('is not generated twice', async () => {
    existing = [existingTask('new_lead'), existingTask('intake', { status: 'open', completed_at: null })]
    const result = await generateMatterTasks(admin(), { matterId: 'matter-1', scope: 'matter' })
    expect(result.ok && !result.created && result.reason).toBe('already_generated')
    expect(inserted()).toEqual([])
  })

  it('swaps only itself when the template changes, keeping the lead list', async () => {
    existing = [
      existingTask('new_lead'),
      existingTask('intake', { status: 'open', completed_at: null, plan_template_id: 'other-template' }),
    ]
    const result = await generateMatterTasks(admin(), {
      matterId: 'matter-1', scope: 'matter', retemplate: true,
    })
    expect(result.ok && result.created).toBe(true)
    const phaseFilter = deletion()?.filters.find(([name, args]) => name === 'in' && args[0] === 'phase')
    expect(phaseFilter?.[1][1]).toContain('intake')
    expect(phaseFilter?.[1][1]).not.toContain('new_lead')
    expect(phaseFilter?.[1][1]).not.toContain('engagement_sent')
  })
})

describe('the whole template', () => {
  it('is still what an unscoped generation writes', async () => {
    await generateMatterTasks(admin(), { matterId: 'matter-1' })
    expect(inserted()).toHaveLength(4)
  })
})
