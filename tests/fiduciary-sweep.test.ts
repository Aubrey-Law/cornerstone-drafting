import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sweepFiduciaryTasks } from '@/lib/fiduciary/sweep'
import { FIDUCIARY_TASK_SOURCE, type FiduciaryTaskRow } from '@/lib/fiduciary/tasks'
import type { GeneratedDatabase } from '@/types/supabase'

/**
 * The sweep that turns fiduciary matrix gaps into task rows.
 *
 * Every test here drives `loadFiduciaries` through a fake client rather than
 * stubbing it, because the question this suite exists to answer is what the
 * sweep does when one of that function's four queries fails — and a stub of
 * the function cannot fail a query.
 */

interface Seed {
  matters?: Record<string, unknown>[]
  contactRoles?: Record<string, unknown>[]
  matterContacts?: Record<string, unknown>[]
  contacts?: Record<string, unknown>[]
  tasks?: Record<string, unknown>[]
  /** Reads of these tables come back as an error, by table name → message. */
  readFails?: Record<string, string>
  /** The one matter whose *own* task read fails, so the others still run. */
  taskReadFailsFor?: string
  insertFails?: string
  updateFails?: string
}

/**
 * A Supabase stand-in shaped on what `loadFiduciaries` and the sweep actually
 * query: `matters`, `contact_roles`, `matter_contacts`, `contacts`, `tasks`.
 *
 * `.eq()` filters are recorded and applied, so `relationship_status = 'hired'`
 * and the sweep's per-matter task scope behave as they do live; `.or()` and
 * `.in()` are no-ops because both callers narrow those results again in
 * memory. Follows `tests/field-audit-tasks.test.ts`'s `fakeClient` for the
 * insert/update recording.
 */
function fakeClient(seed: Seed) {
  const inserted: FiduciaryTaskRow[][] = []
  const updates: Array<{ patch: Record<string, unknown>; ids: string[] }> = []

  const rowsFor = (table: string): Record<string, unknown>[] => {
    if (table === 'matters') return seed.matters ?? []
    if (table === 'contact_roles') return seed.contactRoles ?? []
    if (table === 'matter_contacts') return seed.matterContacts ?? []
    if (table === 'contacts') return seed.contacts ?? []
    if (table === 'tasks') return seed.tasks ?? []
    throw new Error(`the fake client was never given a ${table} table`)
  }

  const client = {
    from: (table: string) => ({
      select: () => {
        const filters: Array<[string, string]> = []
        const builder = {
          eq(column: string, value: string) {
            filters.push([column, value])
            return builder
          },
          or: () => builder,
          in: () => builder,
          then<T>(
            onFulfilled: (value: {
              data: Record<string, unknown>[] | null
              error: { message: string } | null
            }) => T,
          ) {
            const scoped = filters.find(([column]) => column === 'matter_id')?.[1]
            const failure =
              seed.readFails?.[table] ??
              (table === 'tasks' && seed.taskReadFailsFor === scoped
                ? `could not read ${scoped}'s tasks`
                : undefined)
            if (failure !== undefined) {
              return Promise.resolve(onFulfilled({ data: null, error: { message: failure } }))
            }
            const rows = rowsFor(table).filter((row) =>
              filters.every(([column, value]) => String(row[column] ?? '') === value),
            )
            return Promise.resolve(onFulfilled({ data: rows, error: null }))
          },
        }
        return builder
      },
      async insert(values: FiduciaryTaskRow[]) {
        inserted.push(values)
        return { error: seed.insertFails === undefined ? null : { message: seed.insertFails } }
      },
      update: (patch: Record<string, unknown>) => ({
        async in(_column: string, ids: string[]) {
          updates.push({ patch, ids })
          return { error: seed.updateFails === undefined ? null : { message: seed.updateFails } }
        },
      }),
    }),
  }

  return {
    client: client as unknown as SupabaseClient<GeneratedDatabase>,
    inserted,
    updates,
  }
}

const hiredMatter = (id: string) => ({
  id,
  name: `Matter ${id}`,
  client_intake_id: `intake-${id}`,
  relationship_status: 'hired',
})

const appointmentRow = (over: Record<string, unknown>) => ({
  contact_id: 'contact-a',
  role: 'trustee',
  for_party: 'client',
  priority: 1,
  is_coagent: false,
  matter_id: 'matter-1',
  client_intake_id: 'intake-matter-1',
  ...over,
})

const contactRow = (id: string, first: string, last: string) => ({
  id,
  first_name: first,
  middle_name: null,
  last_name: last,
})

/** A `tasks` row as the sweep's own read would find it. */
const storedTask = (over: Record<string, unknown> = {}) => ({
  id: 'task-1',
  matter_id: 'matter-1',
  source: FIDUCIARY_TASK_SOURCE,
  batch_tag: 'fiduciary:matter-1#no_successor:trustee:client',
  status: 'open',
  assignee_id: null,
  title: 'Trustee for the client has no successor.',
  priority: 'normal',
  ...over,
})

/** The row the sweep just wrote, read back as the row it will next find. */
const asStored = (row: FiduciaryTaskRow, id: string) => ({
  id,
  matter_id: row.matter_id,
  source: row.source,
  batch_tag: row.batch_tag,
  status: 'open',
  assignee_id: null,
  title: row.title,
  priority: row.priority,
})

/** One trustee, nobody behind them: the matrix's `no_successor` gap. */
const ONE_TRUSTEE_NO_SUCCESSOR = {
  contactRoles: [appointmentRow({})],
  contacts: [contactRow('contact-a', 'Ann', 'Alpha')],
}

describe('sweepFiduciaryTasks', () => {
  /**
   * The #418 lesson, re-asserted against a different data source. If the
   * appointments cannot be loaded, that is not "this matter has no gaps", it is
   * "we could not tell" — and retiring a task on it would repeat exactly the
   * defect that made a four-times-verified blocker vanish from a live matter.
   *
   * Two assertions, and both are load-bearing. That nothing was written is the
   * consequence that matters. That the sweep *rejects* is how it stays true:
   * a sweep that swallowed the failure and reported an all-zero pass would
   * write nothing this time and tell the tick the sweep went fine, which is
   * the same lie one layer up.
   */
  it('writes nothing at all when the appointments cannot be loaded', async () => {
    const { client, inserted, updates } = fakeClient({
      matters: [hiredMatter('matter-1')],
      // The appointments query fails; everything else would have succeeded.
      readFails: { contact_roles: 'connection reset by peer' },
      // An open task this matter's earlier sweep created. Nothing here may
      // close it: the gap it names has not been shown to be filled.
      tasks: [storedTask()],
    })

    await expect(sweepFiduciaryTasks(client)).rejects.toThrow(/Could not load appointments/)
    expect(inserted).toEqual([])
    expect(updates).toEqual([])
  })

  it('creates one task for a matter whose gap has none yet', async () => {
    const { client, inserted, updates } = fakeClient({
      matters: [hiredMatter('matter-1')],
      ...ONE_TRUSTEE_NO_SUCCESSOR,
    })

    const result = await sweepFiduciaryTasks(client)

    expect(result).toEqual({
      mattersConsidered: 1,
      created: 1,
      kept: 0,
      superseded: 0,
      skipped: 0,
    })
    expect(updates).toEqual([])
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toHaveLength(1)
    expect(inserted[0][0]).toMatchObject({
      matter_id: 'matter-1',
      source: FIDUCIARY_TASK_SOURCE,
      task_type: 'single',
      auto: true,
      batch_tag: 'fiduciary:matter-1#no_successor:trustee:client',
      priority: 'normal',
    })
    expect(inserted[0][0].title).toMatch(/no successor/)
  })

  /**
   * Idempotence over an unchanged matter, and the reason the sweep can run
   * every tick without the queue: a matter nobody has touched costs one read
   * and no writes at all. Seeded from the first pass's own row rather than a
   * hand-written title, so the two passes cannot agree by transcription.
   */
  it('keeps an unchanged task and writes nothing on the second pass', async () => {
    const first = fakeClient({
      matters: [hiredMatter('matter-1')],
      ...ONE_TRUSTEE_NO_SUCCESSOR,
    })
    await sweepFiduciaryTasks(first.client)

    const second = fakeClient({
      matters: [hiredMatter('matter-1')],
      ...ONE_TRUSTEE_NO_SUCCESSOR,
      tasks: [asStored(first.inserted[0][0], 'task-1')],
    })

    const result = await sweepFiduciaryTasks(second.client)

    expect(result).toEqual({
      mattersConsidered: 1,
      created: 0,
      kept: 1,
      superseded: 0,
      skipped: 0,
    })
    expect(second.inserted).toEqual([])
    expect(second.updates).toEqual([])
  })

  it('retires the task once the gap is filled', async () => {
    const { client, inserted, updates } = fakeClient({
      matters: [hiredMatter('matter-1')],
      // A successor now stands behind Ann, so the gap is gone.
      contactRoles: [
        appointmentRow({}),
        appointmentRow({ contact_id: 'contact-b', priority: 2 }),
      ],
      contacts: [contactRow('contact-a', 'Ann', 'Alpha'), contactRow('contact-b', 'Bo', 'Beta')],
      tasks: [storedTask()],
    })

    const result = await sweepFiduciaryTasks(client)

    expect(result).toEqual({
      mattersConsidered: 1,
      created: 0,
      kept: 0,
      superseded: 1,
      skipped: 0,
    })
    expect(inserted).toEqual([])
    expect(updates).toHaveLength(1)
    expect(updates[0].ids).toEqual(['task-1'])
    expect(updates[0].patch).toMatchObject({
      status: 'archived',
      closeout_reason: 'fiduciary_superseded',
    })
    expect(typeof updates[0].patch.skipped_at).toBe('string')
  })

  /**
   * A `note` is not a fault — the matrix says so itself — and a task made from
   * one would teach the reader to ignore the queue. The gate lives in
   * `fiduciaryTaskRows`; this is the sweep honouring it end to end.
   */
  it('creates nothing for a matter whose only issues are notes', async () => {
    const roles = ['trustee', 'personal_rep', 'poa', 'hcp', 'guardian']
    const { client, inserted, updates } = fakeClient({
      matters: [hiredMatter('matter-1')],
      // Ann holds every office and Bo stands behind her in every one: two
      // `concentrated` notes, and not a single gap.
      contactRoles: roles.flatMap((role) => [
        appointmentRow({ role }),
        appointmentRow({ role, contact_id: 'contact-b', priority: 2 }),
      ]),
      contacts: [contactRow('contact-a', 'Ann', 'Alpha'), contactRow('contact-b', 'Bo', 'Beta')],
    })

    const result = await sweepFiduciaryTasks(client)

    expect(result).toEqual({
      mattersConsidered: 1,
      created: 0,
      kept: 0,
      superseded: 0,
      skipped: 0,
    })
    expect(inserted).toEqual([])
    expect(updates).toEqual([])
  })

  /**
   * One matter's database trouble is that matter's alone. It is skipped whole
   * — the same "could not tell" discipline as the load failure above, one
   * scope down — and the rest of the sweep still runs, because 71 matters
   * should not go unswept because the 72nd had a bad minute.
   */
  it('skips a matter whose own tasks cannot be read, and sweeps the rest', async () => {
    const { client, inserted, updates } = fakeClient({
      matters: [hiredMatter('matter-1'), hiredMatter('matter-2')],
      contactRoles: [
        appointmentRow({}),
        appointmentRow({ matter_id: 'matter-2', client_intake_id: 'intake-matter-2' }),
      ],
      contacts: [contactRow('contact-a', 'Ann', 'Alpha')],
      tasks: [storedTask()],
      taskReadFailsFor: 'matter-1',
    })

    const result = await sweepFiduciaryTasks(client)

    expect(result).toEqual({
      mattersConsidered: 2,
      created: 1,
      kept: 0,
      superseded: 0,
      skipped: 1,
    })
    // matter-1 is untouched in both directions: no replacement written, and
    // its open task not closed.
    expect(updates).toEqual([])
    expect(inserted.flat().map((row) => row.matter_id)).toEqual(['matter-2'])
  })

  /**
   * Insert before withdraw, and this is what holds the order. If the insert
   * fails, the tasks that were open a moment ago are still the best record of
   * this matter's gaps — closing them out for replacements that were never
   * written would leave the matter with nothing at all.
   */
  it('withdraws nothing when the insert fails', async () => {
    const { client, inserted, updates } = fakeClient({
      matters: [hiredMatter('matter-1')],
      ...ONE_TRUSTEE_NO_SUCCESSOR,
      // A stale task of this sweep's own — no longer desired, so the plan
      // would supersede it right after the insert this seed makes fail.
      tasks: [storedTask({ batch_tag: 'fiduciary:matter-1#no_successor:poa:client' })],
      insertFails: 'duplicate key value violates unique constraint',
    })

    const result = await sweepFiduciaryTasks(client)

    expect(result).toEqual({
      mattersConsidered: 1,
      created: 0,
      kept: 0,
      superseded: 0,
      skipped: 1,
    })
    expect(inserted).toHaveLength(1)
    expect(updates).toEqual([])
  })
})
