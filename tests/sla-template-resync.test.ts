import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import { resyncMatterSlaTemplate } from '@/lib/slaTasks/generate'

/**
 * A matter's checklist is chosen once, from whatever the practice area was at
 * creation. `resyncMatterSlaTemplate` is what stops that choice outliving a
 * reclassification — it runs on every drafting load, so what it declines to do
 * matters as much as what it does.
 */

interface Op {
  table: string
  verb?: 'select' | 'insert' | 'delete'
  rows?: unknown
}

type Reply = { data: unknown; error: { message: string } | null }

const MATTER = 'matter-1'
const COLLEGE_TEMPLATE = 'template-college'
const ESTATE_TEMPLATE = 'template-estate'

/** One task definition is enough — the scheduling itself is tested elsewhere. */
const COLLEGE_TASKS = [
  { phase: 'intake', name: 'Create matter folder in OneDrive', due_offset_days: 0 },
]

function task(overrides: Record<string, unknown> = {}) {
  return {
    template_id: ESTATE_TEMPLATE,
    status: 'pending',
    notes: null,
    completed_at: null,
    skipped_at: null,
    paused_at: null,
    ...overrides,
  }
}

/**
 * Enough of the query builder to record what was asked for and answer it.
 * `reply` decides each response from the table and verb; every call is pushed to
 * `ops`, so a test can assert that nothing was written.
 */
function stubClient(reply: (op: Op) => Reply) {
  const ops: Op[] = []

  class Builder {
    constructor(private op: Op) {}
    select() {
      this.op.verb ??= 'select'
      return this
    }
    insert(rows: unknown) {
      this.op.verb = 'insert'
      this.op.rows = rows
      return this
    }
    delete() {
      this.op.verb = 'delete'
      return this
    }
    eq() {
      return this
    }
    order() {
      return this
    }
    maybeSingle() {
      return this
    }
    then(onFulfilled: (value: Reply) => unknown) {
      return Promise.resolve(reply(this.op)).then(onFulfilled)
    }
  }

  const client = {
    from(table: string) {
      const op: Op = { table }
      ops.push(op)
      return new Builder(op)
    },
  } as unknown as SupabaseClient

  return { client, ops }
}

const wrote = (ops: Op[]) => ops.some(op => op.verb === 'insert' || op.verb === 'delete')

describe('resyncMatterSlaTemplate', () => {
  it('never generates a checklist for a matter that has none', async () => {
    // A matter with no tasks predates the SLA engine or was deliberately
    // cleared. Filling it in under someone who only opened the workspace would
    // drop 40-odd tasks on them, most already overdue against a past Day 0.
    const { client, ops } = stubClient(op =>
      op.table === 'matter_tasks' ? { data: [], error: null } : { data: null, error: null },
    )

    expect(await resyncMatterSlaTemplate(client, MATTER, 'CP')).toBe('no_checklist')
    expect(wrote(ops)).toBe(false)
    // Cheap in the case that matters: one query, then it stops.
    expect(ops).toHaveLength(1)
  })

  it('does nothing when the matter is already on the right template', async () => {
    const { client, ops } = stubClient(op =>
      op.table === 'matter_tasks'
        ? { data: [task({ template_id: COLLEGE_TEMPLATE })], error: null }
        : { data: { id: COLLEGE_TEMPLATE }, error: null },
    )

    expect(await resyncMatterSlaTemplate(client, MATTER, 'CP')).toBe('unchanged')
    expect(wrote(ops)).toBe(false)
  })

  it('moves an untouched estate checklist onto the college one', async () => {
    const { client, ops } = stubClient(op => {
      if (op.table === 'matters') return { data: { id: MATTER }, error: null }
      if (op.table === 'sla_task_templates') {
        return { data: { id: COLLEGE_TEMPLATE, tasks: COLLEGE_TASKS }, error: null }
      }
      if (op.verb === 'insert') return { data: op.rows, error: null }
      if (op.verb === 'delete') return { data: null, error: null }
      return { data: [task(), task()], error: null }
    })

    expect(await resyncMatterSlaTemplate(client, MATTER, 'CP')).toBe('swapped')
    expect(ops.some(op => op.table === 'matter_tasks' && op.verb === 'delete')).toBe(true)

    const insert = ops.find(op => op.verb === 'insert')
    expect(insert?.table).toBe('matter_tasks')
    expect(insert?.rows).toHaveLength(COLLEGE_TASKS.length)
    expect((insert?.rows as { template_id: string }[])[0].template_id).toBe(COLLEGE_TEMPLATE)
  })

  it('refuses once any of the work is real', async () => {
    for (const started of [
      task({ status: 'completed', completed_at: '2026-08-12T00:00:00Z' }),
      task({ status: 'skipped', skipped_at: '2026-08-12T00:00:00Z' }),
      task({ notes: 'called the school' }),
      task({ status: 'blocked', paused_at: '2026-08-12T00:00:00Z' }),
      task({ template_id: null }),
    ]) {
      const { client, ops } = stubClient(op =>
        op.table === 'matter_tasks'
          ? { data: [task(), started], error: null }
          : { data: { id: COLLEGE_TEMPLATE }, error: null },
      )

      expect(await resyncMatterSlaTemplate(client, MATTER, 'CP')).toBe('work_started')
      expect(wrote(ops), JSON.stringify(started)).toBe(false)
    }
  })

  it('leaves the checklist alone when the target template is not seeded yet', async () => {
    // The migration has not been applied to this database. Deleting a working
    // checklist to replace it with nothing is the worst available outcome.
    const { client, ops } = stubClient(op =>
      op.table === 'matter_tasks'
        ? { data: [task()], error: null }
        : { data: null, error: null },
    )

    expect(await resyncMatterSlaTemplate(client, MATTER, 'CP')).toBe('skipped')
    expect(wrote(ops)).toBe(false)
  })

  it('skips probate without touching the database', async () => {
    const { client, ops } = stubClient(() => ({ data: null, error: null }))

    expect(await resyncMatterSlaTemplate(client, MATTER, 'Probate')).toBe('skipped')
    expect(ops).toHaveLength(0)
  })

  it('swallows a database error rather than failing the page load', async () => {
    const { client } = stubClient(() => ({ data: null, error: { message: 'connection reset' } }))

    expect(await resyncMatterSlaTemplate(client, MATTER, 'CP')).toBe('failed')
  })
})

describe('where the resync runs', () => {
  it('is wired into the drafting load and the practice-area write', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

    // The same two places the design sheet's plan track already self-corrects.
    const load = read('app/admin/drafting/[matterId]/loadDraftingMatterContext.ts')
    expect(load).toContain('resyncMatterSlaTemplate(admin, matterId, normalizedPracticeArea)')
    expect(load).toContain('reconcilePlanTrackDecisions')

    const details = read('app/api/admin/matter-details/route.ts')
    expect(details).toContain('resyncMatterSlaTemplate(admin, matterId, normalizedValue)')
    expect(details).toContain('reconcileDesignSheetPlanTrack(admin, matterId, normalizedValue)')
  })
})
