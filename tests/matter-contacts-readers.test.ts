import { describe, expect, it } from 'vitest'
import { getHousehold } from '@/lib/contacts/getHousehold'
import { loadSpouseContact } from '@/lib/contacts/loadSpouseContact'
import { loadHouseholdChildren } from '@/lib/contacts/loadHouseholdChildren'
import { loadMatterContacts, loadMatterContactsForMatters } from '@/lib/contacts/loadMatterContacts'
import { contactOnMatter } from '@/lib/contacts/assertContactOnMatter'
import { persistFiduciaryRoles } from '@/lib/contacts/persistFiduciaryRoles'

interface Filter { op: string; column: string; value: unknown }
interface Call { table: string; op: 'select' | 'insert' | 'update' | 'delete'; filters: Filter[]; payload?: unknown }

/**
 * Records the filters each query applies, so a test can assert what a write was
 * *scoped to* — which is the whole question for the fiduciary wipe.
 */
function stub(tables: Record<string, unknown[]>) {
  const calls: Call[] = []

  const from = (table: string) => {
    const call: Call = { table, op: 'select', filters: [] }
    let payload: unknown = null

    const rowsFor = (): unknown[] => {
      const rows = (tables[table] ?? []) as Array<Record<string, unknown>>
      return rows.filter(row =>
        call.filters.every(f => {
          if (f.op === 'eq') return row[f.column] === f.value
          if (f.op === 'in') return (f.value as unknown[]).includes(row[f.column])
          return true
        }),
      )
    }

    const chain = {
      select: () => chain,
      insert: (value: unknown) => { call.op = 'insert'; payload = value; call.payload = value; calls.push(call); return chain },
      update: (value: unknown) => { call.op = 'update'; payload = value; return chain },
      delete: () => { call.op = 'delete'; return chain },
      eq: (column: string, value: unknown) => { call.filters.push({ op: 'eq', column, value }); return chain },
      in: (column: string, value: unknown) => { call.filters.push({ op: 'in', column, value }); return chain },
      order: () => chain,
      limit: () => chain,
      // `insert(...).select('id').single()` echoes the created row back, the
      // way PostgREST does — persistFiduciaryRoles needs the new contact id.
      maybeSingle: () => {
        if (call.op === 'insert') return Promise.resolve({ data: { id: `new-${calls.length}`, ...(payload as object) }, error: null })
        calls.push(call)
        return Promise.resolve({ data: rowsFor()[0] ?? null, error: null })
      },
      single: () => {
        if (call.op === 'insert') return Promise.resolve({ data: { id: `new-${calls.length}`, ...(payload as object) }, error: null })
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { admin: { from } as any, calls }
}

const ADA = { id: 'c-ada', first_name: 'Ada', last_name: 'Byron', date_of_birth: '1970-01-01', created_at: '1' }
const LOVELACE = { id: 'c-love', first_name: 'Lovelace', last_name: 'Byron', date_of_birth: '2012-01-01', created_at: '2' }
const NED = { id: 'c-ned', first_name: 'Ned', last_name: 'Byron', created_at: '3' }

describe('getHousehold reads through the matter, not the household', () => {
  it('returns the roster the matter records, with a real contact id for the client', () => {
    return (async () => {
      const { admin, calls } = stub({
        matter_contacts: [
          { matter_id: 'm1', contact_id: 'c-ada', relationship_type: 'self' },
          { matter_id: 'm1', contact_id: 'c-ned', relationship_type: 'spouse' },
          { matter_id: 'm1', contact_id: 'c-love', relationship_type: 'child', child_relationship: 'biological' },
        ],
        contacts: [ADA, NED, LOVELACE],
        contact_roles: [],
      })

      const household = await getHousehold(admin, 'm1')

      expect(household.matterId).toBe('m1')
      // The sentinel is gone: the client is a real contacts row now.
      expect(household.self.contact_id).toBe('c-ada')
      expect(household.self.relationship_type).toBe('self')
      expect(household.spouse?.contact_id).toBe('c-ned')
      expect(household.children.map(c => c.first_name)).toEqual(['Lovelace'])
      // Driven by the join, keyed on the matter.
      expect(calls[0]).toMatchObject({
        table: 'matter_contacts',
        filters: [{ op: 'eq', column: 'matter_id', value: 'm1' }],
      })
      // Roles are matter-scoped too — a 2024 trustee is not a 2026 one.
      expect(calls.find(c => c.table === 'contact_roles')?.filters).toEqual([
        { op: 'eq', column: 'matter_id', value: 'm1' },
      ])
    })()
  })

  it('reads the same person differently on each matter', async () => {
    // The College Prep case: Lovelace is a child on her parents' matter and
    // the client on her own. One contacts row, two relationships.
    const contacts = [ADA, LOVELACE]
    const parents = stub({
      matter_contacts: [
        { matter_id: 'm1', contact_id: 'c-ada', relationship_type: 'self' },
        { matter_id: 'm1', contact_id: 'c-love', relationship_type: 'child' },
      ],
      contacts,
      contact_roles: [],
    })
    const cp = stub({
      matter_contacts: [{ matter_id: 'm2', contact_id: 'c-love', relationship_type: 'self' }],
      contacts,
      contact_roles: [],
    })

    const onParents = await getHousehold(parents.admin, 'm1')
    const onOwn = await getHousehold(cp.admin, 'm2')

    expect(onParents.children[0].contact_id).toBe('c-love')
    expect(onOwn.self.contact_id).toBe('c-love')
    expect(onOwn.self.first_name).toBe('Lovelace')
  })

  it('fails loudly when a matter names no primary client', async () => {
    // Also what catches a caller that still passes an intake id: no join row
    // has matter_id = <intake>, so this throws rather than returning an empty
    // household that would quietly produce a nameless draft.
    const { admin } = stub({ matter_contacts: [], contacts: [], contact_roles: [] })
    await expect(getHousehold(admin, 'intake-1')).rejects.toThrow(/no primary client/)
  })
})

describe('spouse and children read through the join', () => {
  it('finds the spouse the matter records', async () => {
    const { admin, calls } = stub({
      matter_contacts: [{ matter_id: 'm1', contact_id: 'c-ned', relationship_type: 'spouse' }],
      contacts: [NED],
    })
    const spouse = await loadSpouseContact(admin, 'm1')
    expect(spouse?.first_name).toBe('Ned')
    expect(calls[0].filters).toEqual([
      { op: 'eq', column: 'matter_id', value: 'm1' },
      { op: 'eq', column: 'relationship_type', value: 'spouse' },
    ])
  })

  it('returns null when the matter has no spouse', async () => {
    const { admin } = stub({ matter_contacts: [], contacts: [] })
    expect(await loadSpouseContact(admin, 'm1')).toBeNull()
  })

  it('prefers the join row facts over the contact row', async () => {
    // A child can be a stepchild on one matter and biological on another;
    // the join is what states it for this matter.
    const { admin } = stub({
      matter_contacts: [{
        matter_id: 'm1', contact_id: 'c-love', relationship_type: 'child',
        child_relationship: 'stepchild', is_minor: true,
      }],
      contacts: [{ ...LOVELACE, child_relationship: 'biological', is_minor: false }],
    })
    const children = await loadHouseholdChildren(admin, 'm1')
    expect(children).toHaveLength(1)
    expect(children[0].relationship).toBe('stepchild')
  })
})

describe('loadMatterContacts', () => {
  it('returns the matter roster with the join relationship applied', async () => {
    const { admin } = stub({
      matter_contacts: [
        { matter_id: 'm1', contact_id: 'c-ada', relationship_type: 'self' },
        { matter_id: 'm1', contact_id: 'c-love', relationship_type: 'child' },
      ],
      contacts: [ADA, { ...LOVELACE, relationship_type: 'other' }],
    })
    const rows = await loadMatterContacts(admin, 'm1')
    expect(rows.map(r => r.relationship_type)).toEqual(['self', 'child'])
  })

  it('skips a join row whose contact is gone rather than emitting a blank person', async () => {
    const { admin } = stub({
      matter_contacts: [
        { matter_id: 'm1', contact_id: 'c-ada', relationship_type: 'self' },
        { matter_id: 'm1', contact_id: 'c-ghost', relationship_type: 'other' },
      ],
      contacts: [ADA],
    })
    expect(await loadMatterContacts(admin, 'm1')).toHaveLength(1)
  })
})

describe('loadMatterContactsForMatters', () => {
  it('groups one batched read by matter, so a list does not go N+1', async () => {
    const { admin, calls } = stub({
      matter_contacts: [
        { matter_id: 'm1', contact_id: 'c-ada', relationship_type: 'self' },
        { matter_id: 'm1', contact_id: 'c-ned', relationship_type: 'spouse' },
        { matter_id: 'm2', contact_id: 'c-love', relationship_type: 'self' },
      ],
      contacts: [ADA, NED, LOVELACE],
    })

    const byMatter = await loadMatterContactsForMatters(admin, ['m1', 'm2'])

    expect(byMatter.get('m1')?.map(r => r.first_name)).toEqual(['Ada', 'Ned'])
    expect(byMatter.get('m2')?.map(r => r.first_name)).toEqual(['Lovelace'])
    // Two queries total regardless of how many matters were asked for.
    expect(calls.filter(c => c.op === 'select')).toHaveLength(2)
  })

  it('reads nothing when handed no matters', async () => {
    const { admin, calls } = stub({ matter_contacts: [], contacts: [] })
    expect((await loadMatterContactsForMatters(admin, [])).size).toBe(0)
    expect(calls).toHaveLength(0)
  })

  it('keeps a person shared between two matters on both', async () => {
    // Lovelace is a child on her parents' matter and the client on her own.
    const { admin } = stub({
      matter_contacts: [
        { matter_id: 'm1', contact_id: 'c-love', relationship_type: 'child' },
        { matter_id: 'm2', contact_id: 'c-love', relationship_type: 'self' },
      ],
      contacts: [LOVELACE],
    })
    const byMatter = await loadMatterContactsForMatters(admin, ['m1', 'm2'])
    expect(byMatter.get('m1')?.[0].relationship_type).toBe('child')
    expect(byMatter.get('m2')?.[0].relationship_type).toBe('self')
  })
})

describe('contactOnMatter', () => {
  it('confines a write to the matter the caller is on', async () => {
    const { admin } = stub({
      matter_contacts: [{ matter_id: 'm1', contact_id: 'c-ned', relationship_type: 'spouse' }],
    })
    expect(await contactOnMatter(admin, 'm1', 'c-ned')).toEqual({ onMatter: true, relationshipType: 'spouse' })
    // Same household, different matter — an intake-scoped guard would have
    // allowed this one.
    expect(await contactOnMatter(admin, 'm2', 'c-ned')).toEqual({ onMatter: false, relationshipType: null })
  })
})

describe('persistFiduciaryRoles is scoped to the matter', () => {
  it('wipes only this matter’s appointments', async () => {
    // The worst data-loss risk in the migration: scoped to the intake, a second
    // engagement's fiduciary save deletes the first matter's appointments.
    const { admin, calls } = stub({
      matters: [{ id: 'm2', client_intake_id: 'i1' }],
      matter_contacts: [],
      contacts: [],
      contact_roles: [],
    })

    await persistFiduciaryRoles(admin, 'm2', [])

    const wipe = calls.find(c => c.op === 'delete')
    expect(wipe?.table).toBe('contact_roles')
    expect(wipe?.filters).toContainEqual({ op: 'eq', column: 'matter_id', value: 'm2' })
    expect(wipe?.filters.map(f => f.column)).not.toContain('client_intake_id')
  })

  it('still writes the legacy household FK, which the step 2 triggers read', async () => {
    const { admin, calls } = stub({
      matters: [{ id: 'm2', client_intake_id: 'i1' }],
      matter_contacts: [],
      contacts: [],
      contact_roles: [],
    })

    await persistFiduciaryRoles(admin, 'm2', [{
      role: 'trustee', for_party: 'client', priority: 1, is_coagent: false,
      first_name: 'Trusty', last_name: 'Trustee',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any])

    const contactInsert = calls.find(c => c.table === 'contacts' && c.op === 'insert')
    expect(contactInsert).toBeDefined()
    // Writes stay on the legacy FK — step 3 makes it write-only, and the step 2
    // triggers build the join row from it.
    expect((contactInsert?.payload as Record<string, unknown>).client_intake_id).toBe('i1')

    const roleInsert = calls.find(c => c.table === 'contact_roles' && c.op === 'insert')
    expect(roleInsert).toBeDefined()
    // The role carries both keys: matter_id set explicitly rather than left to
    // sync_contact_role_matter, which declines to guess once a client has two.
    const roleRows = roleInsert?.payload as Array<Record<string, unknown>>
    expect(roleRows[0]).toMatchObject({ matter_id: 'm2', client_intake_id: 'i1', role: 'trustee' })
  })
})
