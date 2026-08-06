import { describe, expect, it } from 'vitest'
import { buildFiduciariesFromDesignSheet } from '@/lib/draftPayload/helpers'
import type { ContactRow, DesignSheetRow } from '@/lib/draftPayload/types'

const designSheetWithNonZeroPriority = {
  executor_slots: [
    { id: 'exec-1', contact_id: 'client-rep', is_co: false, order: 4 },
    { id: 'exec-1-co', contact_id: 'client-rep-co', is_co: true, order: 4 },
    { id: 'exec-2', contact_id: 'client-rep-alt', is_co: false, order: 5 },
  ],
  poa_slots: [
    { id: 'poa-1', contact_id: 'poa-agent', is_co: false, order: 7 },
    { id: 'poa-1-co', contact_id: 'poa-agent-co', is_co: true, order: 7 },
    { id: 'poa-2', contact_id: 'poa-agent-alt', is_co: false, order: 9 },
  ],
  hcp_slots: [
    { id: 'hcp-1', contact_id: 'health-care-agent', is_co: false, order: 9 },
    { id: 'hcp-1-co', contact_id: 'health-care-co', is_co: true, order: 9 },
    { id: 'hcp-2', contact_id: 'health-care-alt', is_co: false, order: 11 },
  ],
  guardian_slots: [
    { id: 'guardian-1', contact_id: 'guardian-primary', is_co: false, order: 8 },
    { id: 'guardian-1-co', contact_id: 'guardian-primary-co', is_co: true, order: 8 },
  ],
  spouse_executor_slots: [],
  spouse_poa_slots: [],
  spouse_hcp_slots: [],
  spouse_trustee_slots: [],
  temporary_guardian_slots: [],
  trustee_slots: [],
} as unknown as DesignSheetRow

const contacts = [
  {
    id: 'client-rep',
    first_name: 'Alex',
    middle_name: null,
    last_name: 'Executor',
    preferred_pronoun: null,
    relationship_type: 'family_son',
    relationship_label: 'son',
    address_line1: '11 Executor Road',
    date_of_birth: null,
    phone: null,
    email: null,
    contact_roles: [],
  },
  {
    id: 'client-rep-co',
    first_name: 'Casey',
    middle_name: null,
    last_name: 'Coexecutor',
    preferred_pronoun: null,
    relationship_type: 'family_son',
    relationship_label: 'son',
    address_line1: null,
    date_of_birth: null,
    phone: null,
    email: null,
    contact_roles: [],
  },
  {
    id: 'client-rep-alt',
    first_name: 'Morgan',
    middle_name: null,
    last_name: 'Successor',
    preferred_pronoun: null,
    relationship_type: null,
    relationship_label: null,
    address_line1: null,
    date_of_birth: null,
    phone: null,
    email: null,
    contact_roles: [],
  },
  {
    id: 'poa-agent',
    first_name: 'Pat',
    middle_name: null,
    last_name: 'Attorney',
    preferred_pronoun: null,
    relationship_type: 'friend_friend',
    relationship_label: 'friend',
    address_line1: '300 Finance Ave',
    date_of_birth: null,
    phone: null,
    email: null,
    contact_roles: [],
  },
  {
    id: 'poa-agent-co',
    first_name: 'Jordan',
    middle_name: null,
    last_name: 'CoPOA',
    preferred_pronoun: null,
    relationship_type: 'friend_friend',
    relationship_label: 'friend',
    address_line1: '301 Finance Ave',
    date_of_birth: null,
    phone: null,
    email: null,
    contact_roles: [],
  },
  {
    id: 'poa-agent-alt',
    first_name: 'Noah',
    middle_name: null,
    last_name: 'BackupPOA',
    preferred_pronoun: null,
    relationship_type: null,
    relationship_label: null,
    address_line1: null,
    date_of_birth: null,
    phone: null,
    email: null,
    contact_roles: [],
  },
  {
    id: 'health-care-agent',
    first_name: 'Hannah',
    middle_name: null,
    last_name: 'Care',
    preferred_pronoun: null,
    relationship_type: 'friend_friend',
    relationship_label: 'friend',
    address_line1: '100 Health St',
    date_of_birth: null,
    phone: null,
    email: null,
    contact_roles: [],
  },
  {
    id: 'guardian-primary',
    first_name: 'Gina',
    middle_name: null,
    last_name: 'Guardian',
    preferred_pronoun: null,
    relationship_type: 'friend_friend',
    relationship_label: 'friend',
    address_line1: null,
    date_of_birth: null,
    phone: null,
    email: null,
    contact_roles: [],
  },
  {
    id: 'guardian-primary-co',
    first_name: 'Gale',
    middle_name: null,
    last_name: 'CoGuardian',
    preferred_pronoun: null,
    relationship_type: 'friend_friend',
    relationship_label: 'friend',
    address_line1: null,
    date_of_birth: null,
    phone: null,
    email: null,
    contact_roles: [],
  },
  {
    id: 'health-care-co',
    first_name: 'Cal',
    middle_name: null,
    last_name: 'Care',
    preferred_pronoun: null,
    relationship_type: 'friend_friend',
    relationship_label: 'friend',
    address_line1: '101 Co Health St',
    date_of_birth: null,
    phone: null,
    email: null,
    contact_roles: [],
  },
] as ContactRow[]

describe('buildFiduciariesFromDesignSheet', () => {
  it('maps non-zero primary slot lines and co-agents for PR, POA, HCP, and guardian', () => {
    const payload = buildFiduciariesFromDesignSheet(
      designSheetWithNonZeroPriority,
      contacts,
      { full_name: 'Client', address: '1 Client Ave' },
      { full_name: 'Spouse', address: '2 Spouse Ave' },
    )

    expect(payload.pr_primary).toBe('Alex Executor')
    expect(payload.pr_co_primary).toBe('Casey Coexecutor')
    expect(payload.pr_successor).toBe('Morgan Successor')
    expect(payload.dpoa_primary).toBe('Pat Attorney')
    expect(payload.dpoa_co_agent).toBe('Jordan CoPOA')
    expect(payload.dpoa_successor).toBe('Noah BackupPOA')
    expect(payload.hcp_primary).toBe('Hannah Care')
    expect(payload.hcp_co).toBe('Cal Care')
    expect(payload.guardian_primary).toBe('Gina Guardian')
    expect(payload.guardian_co).toBe('Gale CoGuardian')
  })
})
