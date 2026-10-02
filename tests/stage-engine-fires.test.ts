import { describe, expect, it } from 'vitest'
import { fireEngineStageTask, firesAttorneyTask } from '@/lib/stage-engine/fireStageTasks'
import { mapMatterStageToEngine } from '@/lib/stage-engine/labels'
import { STAGES } from '@/types/database'

/**
 * The stage engine actually fires.
 *
 * Its matter read asked for `matters.client_name`, a column the table does not
 * have. The real database rejects the whole select, the early return swallowed
 * it, and so no stage entry ever produced a task — production held zero
 * `source = 'stage'` rows. This mock rejects unknown `matters` columns the way
 * PostgREST does, which is the case the engine never met in its tests.
 */

const MATTER = '11111111-1111-4111-8111-111111111111'
const MATTERS_COLUMNS = new Set(['stage_entered_at', 'name', 'revision_round'])

function client() {
  const writes: Array<{ table: string; op: string; values: Record<string, unknown> }> = []
  const admin = {
    writes,
    from(table: string) {
      let columns = ''
      const chain: Record<string, unknown> = {}
      for (const op of ['eq', 'in', 'is', 'order', 'limit']) chain[op] = () => chain
      chain.select = (cols: string) => { columns = cols; return chain }
      chain.maybeSingle = async () => {
        if (table === 'matters') {
          const unknown = columns.split(',').map(c => c.trim()).filter(c => !MATTERS_COLUMNS.has(c))
          if (unknown.length > 0) return { data: null, error: { message: `column matters.${unknown[0]} does not exist` } }
          return { data: { stage_entered_at: '2026-10-01T15:00:00Z', name: 'Whitfield — Estate Planning', revision_round: 1 }, error: null }
        }
        if (table === 'v_matter_pipeline') return { data: { client_name: 'Margaret Whitfield' }, error: null }
        return { data: null, error: null }
      }
      for (const op of ['upsert', 'update', 'insert']) {
        chain[op] = (values: Record<string, unknown>) => { writes.push({ table, op, values }); return Promise.resolve({ error: null }) }
      }
      return chain
    },
  }
  return admin
}

// The first pipeline stage whose engine stage hands the attorney a task.
const firing = STAGES.map(s => s.key).find(stage => {
  const engine = mapMatterStageToEngine(stage)
  return engine !== null && firesAttorneyTask(engine)
})

describe('fireEngineStageTask', () => {
  it('has at least one stage that hands the attorney a task', () => {
    expect(firing).toBeDefined()
  })

  it('creates the stage task, named for the client', async () => {
    const admin = client()
    await fireEngineStageTask(admin as never, { matterId: MATTER, matterStage: firing! })

    const task = admin.writes.find(w => w.table === 'tasks' && w.op === 'upsert')
    expect(task, 'a stage entry should write a task').toBeDefined()
    expect(task?.values).toMatchObject({ matter_id: MATTER, source: 'stage', phase: firing, status: 'open' })
    expect(String(task?.values.title)).not.toContain('{client_name}')
  })
})
