import { expect, it } from 'vitest'
import { withStaffAppointments } from '@/lib/intake/forms/loadStaffAppointments'
const person = '20000000-0000-0000-0000-000000000001'
const role = { id: '40000000-0000-0000-0000-000000000001', contact_id: person, role: 'hcp', for_party: 'client', priority: 7, is_coagent: true }
function database(matters: { id: string }[] = [{ id: 'matter' }], error: { message: string } | null = null) {
  const filters: unknown[][] = []
  const rows: Record<string, unknown[]> = { matters, contact_roles: [role], matter_contacts: [{ contact_id: person }], contacts: [{ id: person, first_name: 'Current', last_name: 'Person', address_line1: '1 Main', email: 'current@example.test' }] }
  const client = { from: (table: string) => {
    const query = { select: () => query,
      eq: (key: string, value: unknown) => { filters.push([table, 'eq', key, value]); return query },
      is: (key: string, value: unknown) => { filters.push([table, 'is', key, value]); return query },
      in: (key: string, value: unknown) => { filters.push([table, 'in', key, value]); return query },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows[table], error: table === 'matters' ? error : null }).then(resolve),
    }
    return query
  } }
  return { filters, client: client as unknown as Parameters<typeof withStaffAppointments>[0] }
}
it('keeps all scoped priorities/coagents and clears stale empty slots without disclosing staff snapshots to clients', async () => {
  const db = database()
  const result = await withStaffAppointments(db.client, { id: 'intake', _fid_poa_client: [{ first_name: 'Stale' }] }, false)
  expect(result._fid_hcp_client).toEqual([expect.objectContaining({ first_name: 'Current', street: '1 Main', priority: 7, is_coagent: true })])
  expect(result._fid_poa_client).toEqual([])
  expect(result).not.toHaveProperty('_staff_appointments')
  expect(db.filters).toContainEqual(['contact_roles', 'eq', 'matter_id', 'matter'])
  expect(db.filters).toContainEqual(['matter_contacts', 'eq', 'matter_id', 'matter'])
  expect(db.filters).toContainEqual(['contacts', 'in', 'id', [person]])
})
it('scopes unlinked lead appointments to that intake and to null matter only', async () => {
  const db = database([])
  const result = await withStaffAppointments(db.client, { id: 'intake' })
  expect(db.filters).toContainEqual(['contact_roles', 'is', 'matter_id', null])
  expect(db.filters).toContainEqual(['contact_roles', 'eq', 'client_intake_id', 'intake'])
  expect(result._staff_appointments).toMatchObject({ matterId: null, contacts: [{ id: person, name: 'Current Person' }] })
})
it('fails closed for ambiguous matter ownership or unreadable scope', async () => {
  await expect(withStaffAppointments(database([{ id: 'a' }, { id: 'b' }]).client, { id: 'intake' })).rejects.toThrow('Multiple matters')
  await expect(withStaffAppointments(database([], { message: 'lookup failed' }).client, { id: 'intake' })).rejects.toThrow('lookup failed')
})
