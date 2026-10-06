import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { reconcileHouseholdChildren } from '@/lib/contacts/reconcileHouseholdChildren'
import { syncChildrenProjection } from '@/lib/contacts/syncChildrenProjection'

interface Filter { op: string; column: string; value: unknown }
interface Call { table: string; op: 'select' | 'insert' | 'update' | 'delete'; filters: Filter[]; payload?: unknown }

/** In-memory PostgREST stand-in that records every write. */
function stub(tables: Record<string, unknown[]>) {
  const calls: Call[] = []

  const from = (table: string) => {
    const call: Call = { table, op: 'select', filters: [] }
    let payload: unknown = null

    const rowsFor = (): unknown[] =>
      ((tables[table] ?? []) as Array<Record<string, unknown>>).filter(row =>
        call.filters.every(f => {
          if (f.op === 'eq') return row[f.column] === f.value
          if (f.op === 'in') return (f.value as unknown[]).includes(row[f.column])
          return true
        }),
      )

    const echo = () => Promise.resolve({ data: { id: `new-${calls.length}`, ...(payload as object) }, error: null })
    const chain = {
      select: () => chain,
      insert: (value: unknown) => { call.op = 'insert'; payload = value; call.payload = value; calls.push(call); return chain },
      upsert: (value: unknown) => { call.op = 'insert'; call.payload = value; calls.push(call); return Promise.resolve({ data: null, error: null }) },
      update: (value: unknown) => { call.op = 'update'; payload = value; call.payload = value; return chain },
      delete: () => { call.op = 'delete'; return chain },
      eq: (column: string, value: unknown) => { call.filters.push({ op: 'eq', column, value }); return chain },
      in: (column: string, value: unknown) => { call.filters.push({ op: 'in', column, value }); return chain },
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => {
        if (call.op === 'insert') return echo()
        calls.push(call)
        return Promise.resolve({ data: rowsFor()[0] ?? null, error: null })
      },
      single: () => {
        if (call.op === 'insert') return echo()
        calls.push(call)
        return Promise.resolve({ data: rowsFor()[0] ?? null, error: null })
      },
      then: (onFulfilled?: (v: { data: unknown; error: null }) => unknown, onRejected?: (r: unknown) => unknown) => {
        if (call.op !== 'insert') calls.push(call)
        const data = call.op === 'select' ? rowsFor() : payload
        return Promise.resolve({ data, error: null }).then(onFulfilled, onRejected)
      },
    }
    return chain
  }

  return { admin: { from } as unknown as SupabaseClient<Database>, calls }
}

const SELF = { id: 'c-self', client_intake_id: 'intake-1', relationship_type: 'self', first_name: 'Ada', last_name: 'Byron' }
const CHILD = {
  id: 'c-kid', client_intake_id: 'intake-1', relationship_type: 'child',
  first_name: 'Lovelace', last_name: 'Byron', child_relationship: 'adopted', parentage: 'client',
}

const entered = {
  id: 'tmp', first_name: 'Lovelace', middle_name: '', last_name: 'Byron', suffix: '',
  date_of_birth: '2015-04-01', pronouns: '', email: '', phone: '', same_address: false,
  parent: 'both', relationship: 'biological',
}

describe('saving entered children from the client intake', () => {
  it('saves when the matter id differs from the intake id', async () => {
    // Production shape: matter 0ed9… belongs to intake 7770…. Reading the
    // household by the intake id found no client and failed every save.
    const { admin, calls } = stub({
      matters: [{ id: 'matter-1', client_intake_id: 'intake-1' }],
      matter_contacts: [
        { matter_id: 'matter-1', contact_id: 'c-self', relationship_type: 'self' },
        { matter_id: 'matter-1', contact_id: 'c-kid', relationship_type: 'child', child_relationship: 'adopted' },
      ],
      contacts: [SELF, CHILD],
      contact_roles: [],
      client_intake: [{ id: 'intake-1', first_name: 'Ada' }],
      design_sheets: [],
    })

    await expect(reconcileHouseholdChildren(admin, 'intake-1', [entered])).resolves.toBeUndefined()

    expect(calls.find(c => c.table === 'matter_contacts' && c.op === 'select')?.filters)
      .toEqual([{ op: 'eq', column: 'matter_id', value: 'matter-1' }])
    const update = calls.find(c => c.table === 'contacts' && c.op === 'update')
    expect(update?.filters).toEqual([{ op: 'eq', column: 'id', value: 'c-kid' }])
    expect(update?.payload).toMatchObject({ first_name: 'Lovelace', date_of_birth: '2015-04-01' })
  })

  it('saves a new child for a lead who has no matter yet', async () => {
    const { admin, calls } = stub({
      matters: [],
      matter_contacts: [],
      contacts: [SELF],
      contact_roles: [],
      client_intake: [{ id: 'intake-1', first_name: 'Ada' }],
      design_sheets: [],
    })

    await expect(reconcileHouseholdChildren(admin, 'intake-1', [entered])).resolves.toBeUndefined()

    const insert = calls.find(c => c.table === 'contacts' && c.op === 'insert')
    expect(insert?.payload).toMatchObject({
      client_intake_id: 'intake-1', relationship_type: 'child', first_name: 'Lovelace', last_name: 'Byron',
    })
  })

  it('keeps a stored relationship for a lead with no matter when the entry omits it', async () => {
    const { admin, calls } = stub({
      matters: [],
      contacts: [SELF, CHILD],
      contact_roles: [],
      client_intake: [{ id: 'intake-1', first_name: 'Ada' }],
      design_sheets: [],
    })
    const { relationship: _omit, parent: _p, ...noRelationship } = entered

    await reconcileHouseholdChildren(admin, 'intake-1', [noRelationship])

    const update = calls.find(c => c.table === 'contacts' && c.op === 'update')
    expect(update?.payload).toMatchObject({ child_relationship: 'adopted', parentage: 'client' })
  })
})

describe('rebuilding the children projection from an intake id', () => {
  it('reads the household through the intake’s matter', async () => {
    const { admin, calls } = stub({
      matters: [{ id: 'matter-1', client_intake_id: 'intake-1' }],
      matter_contacts: [
        { matter_id: 'matter-1', contact_id: 'c-self', relationship_type: 'self' },
        { matter_id: 'matter-1', contact_id: 'c-kid', relationship_type: 'child' },
      ],
      contacts: [SELF, CHILD],
      contact_roles: [],
      client_intake: [{ id: 'intake-1' }],
      design_sheets: [],
    })

    await expect(syncChildrenProjection(admin, 'intake-1')).resolves.toBeUndefined()
    expect(calls.some(c => c.table === 'contacts' && c.op === 'update')).toBe(true)
  })
})
