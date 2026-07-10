import { describe, expect, it } from 'vitest'
import { buildFiduciarySlotsFromContacts } from '@/lib/contacts/intakeFiduciarySnapshot'

describe('buildFiduciarySlotsFromContacts', () => {
  it('maps contact_roles to design sheet slots with contact_id', () => {
    const slots = buildFiduciarySlotsFromContacts([
      {
        id: 'contact-trustee',
        first_name: 'Pat',
        last_name: 'Trustee',
        contact_roles: [{ role: 'trustee', for_party: 'client', priority: 1, is_coagent: false }],
      },
      {
        id: 'contact-pr',
        first_name: 'Pat',
        last_name: 'Executor',
        contact_roles: [{ role: 'personal_rep', for_party: 'client', priority: 1, is_coagent: false }],
      },
    ])

    expect(slots.trustee_slots?.[0]).toMatchObject({
      contact_id: 'contact-trustee',
      order: 0,
      is_co: false,
    })
    expect(slots.executor_slots?.[0]).toMatchObject({
      contact_id: 'contact-pr',
      order: 0,
    })
  })
})
