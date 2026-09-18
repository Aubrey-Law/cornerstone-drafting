import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  deleteR2Key: vi.fn(),
  cancelEnvelope: vi.fn(),
  resolveEsignProvider: vi.fn(),
}))

vi.mock('@/lib/r2Delete', () => ({ deleteR2Key: mocks.deleteR2Key }))
vi.mock('@/lib/esign/firma', () => ({ resolveEsignProvider: mocks.resolveEsignProvider }))

import { ContactDeletionError, deleteContact } from '@/lib/contacts/deleteContact'
import { deleteLeadPermanently } from '@/lib/leads/removeLead'
import { MatterDeletionError } from '@/lib/matters/deleteMatter'
import { deletePerson } from '@/lib/people/deletePerson'

type Row = Record<string, unknown>

/**
 * An in-memory stand-in for the admin client that actually applies filters and
 * removes what it is told to. A fake that answers every select with the same
 * rows cannot tell a delete that walked a person's second engagement from one
 * that deleted the first one twice, which is the thing these tests are for.
 */
function createFakeAdmin(tables: Record<string, Row[]>) {
  const store: Record<string, Row[]> = {}
  for (const [table, rows] of Object.entries(tables)) store[table] = rows.map(row => ({ ...row }))

  const deleted: string[] = []

  const matches = (row: Row, filters: [string, 'eq' | 'in', unknown][]) =>
    filters.every(([column, op, value]) =>
      op === 'eq' ? row[column] === value : (value as unknown[]).includes(row[column]),
    )

  class Query {
    private op: 'select' | 'delete' | 'insert' | 'update' = 'select'
    private patch: Row = {}
    private readonly filters: [string, 'eq' | 'in', unknown][] = []

    constructor(private readonly table: string) {}

    select() { this.op = 'select'; return this }
    delete() { this.op = 'delete'; return this }
    insert(row: Row) { this.op = 'insert'; this.patch = row; return this }
    update(row: Row) { this.op = 'update'; this.patch = row; return this }
    eq(column: string, value: unknown) { this.filters.push([column, 'eq', value]); return this }
    in(column: string, value: unknown) { this.filters.push([column, 'in', value]); return this }
    limit() { return this }

    private run() {
      const rows = store[this.table] ?? (store[this.table] = [])
      const hits = rows.filter(row => matches(row, this.filters))
      if (this.op === 'delete') {
        deleted.push(this.table)
        store[this.table] = rows.filter(row => !matches(row, this.filters))
        return Promise.resolve({ data: null, error: null })
      }
      if (this.op === 'insert') {
        rows.push(this.patch)
        return Promise.resolve({ data: null, error: null })
      }
      if (this.op === 'update') {
        for (const row of hits) Object.assign(row, this.patch)
        return Promise.resolve({ data: null, error: null })
      }
      return Promise.resolve({ data: hits, error: null })
    }

    maybeSingle() {
      return this.run().then(result => ({
        ...result,
        data: Array.isArray(result.data) ? (result.data[0] ?? null) : result.data,
      }))
    }

    then<T>(resolve: (value: { data: unknown; error: { message: string } | null }) => T) {
      return this.run().then(resolve)
    }
  }

  return {
    client: { from: (table: string) => new Query(table) } as never,
    store,
    deletedTables: () => deleted,
  }
}

const INTAKE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const INTAKE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const MATTER_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const MATTER_B = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const SELF_CONTACT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const CHILD_CONTACT = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

function matter(over: Row = {}): Row {
  return {
    id: MATTER_A,
    client_intake_id: INTAKE_A,
    name: 'Byron Family Trust',
    matter_number: '2026-EP-001',
    stage: 'drafting',
    status: 'active',
    relationship_status: 'lead',
    created_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveEsignProvider.mockReturnValue({
    ok: true,
    provider: { cancelEnvelope: mocks.cancelEnvelope },
  })
})

describe('deleteLeadPermanently', () => {
  it('destroys the opportunity behind the lead, not just its status', async () => {
    const fake = createFakeAdmin({
      client_intake: [{ id: INTAKE_A, matter_id: MATTER_A, engagement_envelope_id: null, engagement_status: null }],
      matters: [matter()],
    })

    const result = await deleteLeadPermanently(fake.client, INTAKE_A)

    expect(result).toMatchObject({ intakeId: INTAKE_A, matterId: MATTER_A })
    expect(fake.store.matters).toEqual([])
    expect(fake.store.client_intake).toEqual([])
  })

  it('withdraws a signature request the lead is about to take with it', async () => {
    const fake = createFakeAdmin({
      client_intake: [{ id: INTAKE_A, matter_id: MATTER_A, engagement_envelope_id: 'env-1', engagement_status: 'sent' }],
      matters: [matter()],
    })

    await deleteLeadPermanently(fake.client, INTAKE_A)

    expect(mocks.cancelEnvelope).toHaveBeenCalledWith('env-1')
  })

  it('leaves an executed agreement alone', async () => {
    const fake = createFakeAdmin({
      client_intake: [{ id: INTAKE_A, matter_id: MATTER_A, engagement_envelope_id: 'env-1', engagement_status: 'signed' }],
      matters: [matter()],
    })

    await deleteLeadPermanently(fake.client, INTAKE_A, { confirmProtected: true })

    expect(mocks.cancelEnvelope).not.toHaveBeenCalled()
  })

  it('holds a hired lead for confirmation instead of destroying it', async () => {
    const fake = createFakeAdmin({
      client_intake: [{ id: INTAKE_A, matter_id: MATTER_A, engagement_envelope_id: null, engagement_status: null }],
      matters: [matter({ relationship_status: 'hired' })],
    })

    const error = await deleteLeadPermanently(fake.client, INTAKE_A).catch(e => e)

    expect(error).toBeInstanceOf(MatterDeletionError)
    expect(error.code).toBe('confirmation_required')
    expect(error.protections).toEqual(['hired'])
    expect(fake.store.matters).toHaveLength(1)
  })

  it('deletes an intake that never became an opportunity', async () => {
    const fake = createFakeAdmin({
      client_intake: [{ id: INTAKE_A, matter_id: null, engagement_envelope_id: null, engagement_status: null }],
      matters: [],
    })

    const result = await deleteLeadPermanently(fake.client, INTAKE_A)

    expect(result.matterId).toBeNull()
    expect(fake.store.client_intake).toEqual([])
  })

  it('finds the matter that points at an intake with no back-reference', async () => {
    // matters.client_intake_id is ON DELETE RESTRICT, so deleting the intake on
    // its own would fail against the constraint halfway through.
    const fake = createFakeAdmin({
      client_intake: [{ id: INTAKE_A, matter_id: null, engagement_envelope_id: null, engagement_status: null }],
      matters: [matter()],
    })

    const result = await deleteLeadPermanently(fake.client, INTAKE_A)

    expect(result.matterId).toBe(MATTER_A)
    expect(fake.store.matters).toEqual([])
  })

  it('reports a lead that is not there as not found', async () => {
    const fake = createFakeAdmin({ client_intake: [] })

    const error = await deleteLeadPermanently(fake.client, INTAKE_A).catch(e => e)

    expect(error).toBeInstanceOf(MatterDeletionError)
    expect(error.code).toBe('not_found')
  })
})

describe('deleteContact', () => {
  it('removes a relationship contact and the roles hanging off it', async () => {
    const fake = createFakeAdmin({
      contacts: [{ id: CHILD_CONTACT, first_name: 'Ada', last_name: 'Byron', preferred_name: null, relationship_type: 'child' }],
      contact_roles: [{ contact_id: CHILD_CONTACT, role: 'successor_trustee' }],
      matter_contacts: [],
    })

    const result = await deleteContact(fake.client, CHILD_CONTACT)

    expect(result).toMatchObject({ contactId: CHILD_CONTACT, name: 'Ada Byron' })
    expect(fake.store.contacts).toEqual([])
    expect(fake.store.contact_roles).toEqual([])
  })

  it('refuses the contact that is the client on a matter of their own', async () => {
    const fake = createFakeAdmin({
      contacts: [{ id: SELF_CONTACT, first_name: 'Ada', last_name: 'Byron', preferred_name: null, relationship_type: 'child' }],
      contact_roles: [],
      matter_contacts: [{ matter_id: MATTER_B, contact_id: SELF_CONTACT, relationship_type: 'self' }],
    })

    const error = await deleteContact(fake.client, SELF_CONTACT).catch(e => e)

    expect(error).toBeInstanceOf(ContactDeletionError)
    expect(error.code).toBe('blocked')
    expect(error.message).toContain('Ada Byron')
    expect(fake.store.contacts).toHaveLength(1)
  })

  it('reports a contact that is not there as not found', async () => {
    const fake = createFakeAdmin({ contacts: [] })

    const error = await deleteContact(fake.client, CHILD_CONTACT).catch(e => e)

    expect(error).toBeInstanceOf(ContactDeletionError)
    expect(error.code).toBe('not_found')
  })
})

describe('deletePerson', () => {
  /** A returning client: two engagements, one person, one `self` contact. */
  function returningClient(over: { relationship_status?: string } = {}) {
    return createFakeAdmin({
      client_intake: [
        { id: INTAKE_A, matter_id: MATTER_A, engagement_envelope_id: null, engagement_status: null },
        { id: INTAKE_B, matter_id: MATTER_B, engagement_envelope_id: null, engagement_status: null },
      ],
      matters: [
        matter(),
        matter({
          id: MATTER_B,
          client_intake_id: INTAKE_B,
          matter_number: '2026-EP-042',
          relationship_status: over.relationship_status ?? 'lead',
        }),
      ],
      matter_contacts: [
        { matter_id: MATTER_A, contact_id: SELF_CONTACT, relationship_type: 'self' },
        { matter_id: MATTER_B, contact_id: SELF_CONTACT, relationship_type: 'self' },
      ],
      contacts: [],
      contact_roles: [],
    })
  }

  it('takes every engagement of the person, not just the row the list showed', async () => {
    const fake = returningClient()

    const result = await deletePerson(fake.client, `intake:${INTAKE_A}`)

    expect(result.source).toBe('intake')
    expect(result.intakeIds.sort()).toEqual([INTAKE_A, INTAKE_B].sort())
    expect(fake.store.matters).toEqual([])
    expect(fake.store.client_intake).toEqual([])
  })

  it('asks once for the whole person before destroying any of it', async () => {
    const fake = returningClient({ relationship_status: 'hired' })

    const error = await deletePerson(fake.client, `intake:${INTAKE_A}`).catch(e => e)

    expect(error).toBeInstanceOf(MatterDeletionError)
    expect(error.code).toBe('confirmation_required')
    expect(error.protections).toEqual(['hired'])
    // The prospect engagement must survive the refusal too: half a person
    // deleted is worse than none.
    expect(fake.store.matters).toHaveLength(2)
    expect(fake.store.client_intake).toHaveLength(2)
  })

  it('goes through with the whole person once confirmed', async () => {
    const fake = returningClient({ relationship_status: 'hired' })

    const result = await deletePerson(fake.client, `intake:${INTAKE_A}`, { confirmProtected: true })

    expect(result.protections).toEqual(['hired'])
    expect(fake.store.matters).toEqual([])
  })

  it('dispatches a contacts-backed row to the contact delete', async () => {
    const fake = createFakeAdmin({
      contacts: [{ id: CHILD_CONTACT, first_name: 'Ada', last_name: 'Byron', preferred_name: null, relationship_type: 'child' }],
      contact_roles: [],
      matter_contacts: [],
    })

    const result = await deletePerson(fake.client, `contact:${CHILD_CONTACT}`)

    expect(result).toMatchObject({ source: 'contact', intakeIds: [] })
    expect(fake.store.contacts).toEqual([])
  })

  it('reports a person who is not there as not found', async () => {
    const fake = createFakeAdmin({ client_intake: [] })

    const error = await deletePerson(fake.client, `intake:${INTAKE_A}`).catch(e => e)

    expect(error).toBeInstanceOf(MatterDeletionError)
    expect(error.code).toBe('not_found')
  })
})

describe('delete wiring', () => {
  const read = (relativePath: string) =>
    fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')

  it('exposes DELETE on /api/admin/people/[id] behind the administrator gate', () => {
    const route = read('app/api/admin/people/[id]/route.ts')
    expect(route).toContain('export async function DELETE')
    expect(route).toContain('requirePermanentDeletionRole')
    expect(route).toContain('deletePerson')
    expect(route).toContain('requiresConfirmation')
  })

  it('offers both exits on a lead row, and says which is which', () => {
    const menu = read('components/leads/LeadActionsMenu.tsx')
    expect(menu).toContain('Archive lead')
    expect(menu).toContain('Delete permanently')
    const client = read('app/admin/leads/LeadsClient.tsx')
    expect(client).toContain('Archive selected')
    expect(client).toContain('permanent: true')
  })

  it('offers the directory its only exit from the person panel', () => {
    const panel = read('app/admin/contacts/ContactSidePanel.tsx')
    expect(panel).toContain('/api/admin/people/')
    expect(panel).toContain('Delete permanently')
  })
})
