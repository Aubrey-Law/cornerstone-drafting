import { beforeEach, describe, expect, it, vi } from 'vitest'
import { taskFixture } from './fixtures/task'

/**
 * Every task surface labels a task with the record it hangs off, and the
 * firm-wide queue is the one place that label is the only way to tell two
 * identical plan tasks ("Hold discovery call") apart.
 *
 * It silently showed nothing for months: the lookup selected
 * `matters.client_name`, a column that has never existed — the name is built by
 * `v_matter_pipeline` from `client_intake`. PostgREST errored, the error was
 * discarded, and every matter-linked task came back unlabelled.
 */

const selects: { table: string; cols: string }[] = []
let tables: Record<string, unknown[]> = {}
let errors: Record<string, { message: string }> = {}

function chainFor(table: string) {
  const result = () => ({ data: tables[table] ?? [], error: errors[table] ?? null })
  const chain: Record<string, unknown> = {}
  for (const method of ['neq', 'in', 'eq', 'is', 'or', 'order']) chain[method] = () => chain
  chain.select = (cols: string) => {
    selects.push({ table, cols })
    return chain
  }
  chain.limit = async () => result()
  chain.then = (resolve: (v: ReturnType<typeof result>) => unknown) =>
    Promise.resolve(result()).then(resolve)
  return chain
}

vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({ from: (table: string) => chainFor(table) }),
  ADMIN_EMAIL: 'admin@example.invalid',
}))

const { fetchTasks } = await import('@/lib/queries/tasks')

const MATTER = 'm-1'
const INTAKE = 'ci-1'

beforeEach(() => {
  selects.length = 0
  errors = {}
  tables = {
    tasks: [taskFixture({ id: 't-1', matter_id: MATTER, source: 'sla', title: 'Hold discovery call' })],
    matters: [{ id: MATTER, name: 'Whitfield Estate Plan', client_intake_id: INTAKE }],
    client_intake: [
      { id: INTAKE, full_name: 'Whitfield, Margaret', first_name: 'Margaret', last_name: 'Whitfield', email: 'm@example.invalid' },
    ],
    users: [],
  }
})

describe('labelling a matter-linked task', () => {
  it('names the person behind the matter', async () => {
    const [task] = await fetchTasks({})
    expect(task.record_name).toBe('Whitfield, Margaret')
  })

  it('never asks `matters` for a client_name it does not have', async () => {
    await fetchTasks({})
    const matterSelect = selects.find(s => s.table === 'matters')
    expect(matterSelect?.cols).toBeDefined()
    expect(matterSelect!.cols).not.toContain('client_name')
    expect(matterSelect!.cols).toContain('client_intake_id')
  })

  it('falls back to the matter name when the intake has no person on it', async () => {
    tables.client_intake = [
      { id: INTAKE, full_name: null, first_name: null, last_name: null, email: null },
    ]
    const [task] = await fetchTasks({})
    // '' from the trimmed concat must fall through, which `??` would not do.
    expect(task.record_name).toBe('Whitfield Estate Plan')
  })

  it('reports null rather than an empty label when nothing names the matter', async () => {
    tables.matters = [{ id: MATTER, name: '   ', client_intake_id: null }]
    const [task] = await fetchTasks({})
    expect(task.record_name).toBeNull()
  })

  it('looks the people up once, covering leads and matters together', async () => {
    tables.tasks = [
      taskFixture({ id: 't-1', matter_id: MATTER }),
      taskFixture({ id: 't-2', lead_id: 'ci-2', matter_id: null }),
    ]
    tables.client_intake = [
      { id: INTAKE, full_name: 'Whitfield, Margaret', first_name: null, last_name: null, email: null },
      { id: 'ci-2', full_name: 'Okafor, Ada', first_name: null, last_name: null, email: null },
    ]
    const rows = await fetchTasks({})
    expect(rows.map(r => r.record_name).sort()).toEqual(['Okafor, Ada', 'Whitfield, Margaret'])
    expect(selects.filter(s => s.table === 'client_intake')).toHaveLength(1)
  })
})

describe('when the lookup itself fails', () => {
  it('says so instead of blanking every label in silence', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    errors.matters = { message: 'column matters.client_name does not exist' }
    tables.matters = []

    const [task] = await fetchTasks({})

    expect(task.record_name).toBeNull()
    expect(logged).toHaveBeenCalledWith(
      'attachDisplayNames matters:',
      'column matters.client_name does not exist',
    )
    logged.mockRestore()
  })
})
