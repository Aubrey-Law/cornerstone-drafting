import { describe, expect, it } from 'vitest'
import { compareOffices, samePerson } from '@/lib/fiduciary/compare'
import type { FiduciaryChainView } from '@/lib/fiduciary/view'

const slot = (key: string, primary: string | null, successor: string | null = null) => ({
  key,
  role: key,
  primary,
  successor,
})
const chain = (roleKey: FiduciaryChainView['roleKey'], names: string[], forParty: 'client' | 'spouse' = 'client'): FiduciaryChainView => ({
  roleKey,
  role: roleKey,
  forParty,
  people: names.map(name => ({ name, isCoagent: false })),
})

describe('samePerson', () => {
  it('matches first and last, allowing a middle name on the people record', () => {
    expect(samePerson('Morgan Client', 'Morgan Lee Client')).toBe(true)
    expect(samePerson('Morgan Client', 'Riley Client')).toBe(false)
  })

  it('compares a co-agent pair on its first name', () => {
    expect(samePerson('Morgan Client & Riley Client', 'Morgan Client')).toBe(true)
  })
})

describe('compareOffices', () => {
  it('agrees when the sheet and the people records name the same order of service', () => {
    const [trustee] = compareOffices([slot('trustee_slots', 'Morgan Client', 'Riley Client')], [
      chain('trustee', ['Morgan Client', 'Riley Client']),
    ])
    expect(trustee).toMatchObject({ agreement: 'agree', recorded: ['Morgan Client', 'Riley Client'] })
  })

  it('flags a different principal, or a different successor', () => {
    const rows = compareOffices(
      [slot('trustee_slots', 'Morgan Client'), slot('executor_slots', 'Morgan Client', 'Riley Client')],
      [chain('trustee', ['Riley Client']), chain('personal_rep', ['Morgan Client', 'Sam Other'])],
    )
    expect(rows.map(row => row.agreement)).toEqual(['differs', 'differs'])
  })

  it('says which side has a name the other lacks', () => {
    const rows = compareOffices([slot('poa_slots', 'Morgan Client'), slot('hcp_slots', null)], [chain('hcp', ['Riley Client'])])
    expect(rows.map(row => row.agreement)).toEqual(['sheet_only', 'people_only'])
  })

  it('keeps the spouse’s offices apart from the client’s', () => {
    const [spouseTrustee] = compareOffices([slot('spouse_trustee_slots', 'Morgan Client')], [chain('trustee', ['Morgan Client'])])
    expect(spouseTrustee.agreement).toBe('sheet_only')
  })

  it('does not compare an office the people records have no counterpart for', () => {
    const [temporary] = compareOffices([slot('temporary_guardian_slots', 'Morgan Client')], [])
    expect(temporary).toMatchObject({ agreement: 'not_compared', recorded: null })
  })
})
