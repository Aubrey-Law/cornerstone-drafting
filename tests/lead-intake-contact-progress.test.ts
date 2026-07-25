import { describe, expect, it } from 'vitest'
import { applyContactIntakeData } from '@/lib/intakeContactHydration'
import { getLeadIntakeProgress } from '@/lib/leads/intakeProgress'

function segment(intake: Record<string, unknown>, id: string): boolean {
  return getLeadIntakeProgress(intake).find((item) => item.id === id)?.complete ?? false
}

describe('contact-backed lead intake progress', () => {
  it('uses canonical spouse, child, and fiduciary contact hydration for active progress segments', () => {
    const intake = {
      id: 'intake-1',
      first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com', phone: '617-555-0100',
      address_line1: '1 Main Street', city: 'Boston', state: 'MA', zip: '02108', date_of_birth: '1980-01-01', county: 'Suffolk',
      marital_status: 'married', has_children: true, has_minor_children: true,
      estate_value: 'under_500k', asset_types: ['financial'], has_real_property: false,
      planning_goals: ['avoid_probate'],
    }
    const contacts = [
      { id: 'spouse', relationship_type: 'spouse', first_name: 'John', last_name: 'Doe', date_of_birth: '1981-01-01' },
      { id: 'child', relationship_type: 'child', first_name: 'Sam', last_name: 'Doe', date_of_birth: '2014-01-01' },
      {
        id: 'client-agent', first_name: 'Pat', last_name: 'Client Agent', contact_roles: [
          { role: 'personal_rep', for_party: 'client', priority: 1 },
          { role: 'trustee', for_party: 'client', priority: 1 },
          { role: 'poa', for_party: 'client', priority: 1 },
          { role: 'hcp', for_party: 'client', priority: 1 },
        ],
      },
      {
        id: 'spouse-agent', first_name: 'Alex', last_name: 'Spouse Agent', contact_roles: [
          { role: 'personal_rep', for_party: 'spouse', priority: 1 },
          { role: 'poa', for_party: 'spouse', priority: 1 },
          { role: 'hcp', for_party: 'spouse', priority: 1 },
        ],
      },
      {
        id: 'guardian', first_name: 'Morgan', last_name: 'Guardian', contact_roles: [
          { role: 'guardian', for_party: 'client', priority: 1 },
        ],
      },
    ]

    const hydrated = applyContactIntakeData(intake, contacts)

    expect(segment(hydrated, 'household')).toBe(true)
    expect(segment(hydrated, 'fiduciaries')).toBe(true)
  })
})
