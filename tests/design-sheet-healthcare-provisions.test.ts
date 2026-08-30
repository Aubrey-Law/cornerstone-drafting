import { describe, expect, it } from 'vitest'
import {
  getDesignSheetHealthcareProvisions,
  setDesignSheetHealthcareProvisions,
} from '@/lib/designSheetHealthcareProvisions'
import type { DesignSheet } from '@/types/database'

function sheetWithDecisions(decisions: Record<string, unknown>): Pick<DesignSheet, 'decisions' | 'hcp_anatomical_gift'> {
  return { decisions, hcp_anatomical_gift: null }
}

describe('designSheetHealthcareProvisions additional HIPAA', () => {
  it('migrates legacy shared additional HIPAA agents onto the client list', () => {
    const provisions = getDesignSheetHealthcareProvisions(sheetWithDecisions({
      healthcare_provisions: {
        hipaa_additional_agent_contact_ids: ['c1', 'c2'],
      },
    }))

    expect(provisions.client_hipaa_additional_agent_contact_ids).toEqual(['c1', 'c2'])
    expect(provisions.spouse_hipaa_additional_agent_contact_ids).toEqual([])
    expect(provisions.hipaa_additional_agent_contact_ids).toEqual(['c1', 'c2'])
  })

  it('reads independent client and spouse additional HIPAA agents', () => {
    const provisions = getDesignSheetHealthcareProvisions(sheetWithDecisions({
      healthcare_provisions: {
        client_hipaa_additional_agent_contact_ids: ['client-a'],
        spouse_hipaa_additional_agent_contact_ids: ['spouse-b'],
        hipaa_additional_agent_contact_ids: ['legacy-ignored'],
      },
    }))

    expect(provisions.client_hipaa_additional_agent_contact_ids).toEqual(['client-a'])
    expect(provisions.spouse_hipaa_additional_agent_contact_ids).toEqual(['spouse-b'])
    expect(provisions.hipaa_additional_agent_contact_ids).toEqual(['client-a'])
  })

  it('keeps the legacy key synced when writing client additional agents', () => {
    const decisions = setDesignSheetHealthcareProvisions(sheetWithDecisions({}), {
      client_hipaa_additional_agent_contact_ids: ['c9'],
      spouse_hipaa_additional_agent_contact_ids: ['s9'],
    })

    const raw = (decisions as unknown as { healthcare_provisions: Record<string, unknown> }).healthcare_provisions
    expect(raw.client_hipaa_additional_agent_contact_ids).toEqual(['c9'])
    expect(raw.spouse_hipaa_additional_agent_contact_ids).toEqual(['s9'])
    expect(raw.hipaa_additional_agent_contact_ids).toEqual(['c9'])
  })
})

describe('client anatomical gift restrictions', () => {
  it('reads through to the legacy column for a sheet saved before the field existed', () => {
    const provisions = getDesignSheetHealthcareProvisions({
      decisions: {},
      hcp_anatomical_gift: 'specified',
      hcp_anatomical_specified: 'Corneas and skin only.',
    })
    expect(provisions.client_anatomical_restrictions).toBe('Corneas and skin only.')
  })

  it('prefers the namespace value once one is stored', () => {
    const provisions = getDesignSheetHealthcareProvisions({
      decisions: { healthcare_provisions: { client_anatomical_restrictions: 'No skin or bone.' } },
      hcp_anatomical_gift: 'specified',
      hcp_anatomical_specified: 'Corneas and skin only.',
    })
    expect(provisions.client_anatomical_restrictions).toBe('No skin or bone.')
  })

  it('is null when neither carries a value, and ignores a blank column', () => {
    expect(getDesignSheetHealthcareProvisions({
      decisions: {},
      hcp_anatomical_gift: null,
    }).client_anatomical_restrictions).toBeNull()

    expect(getDesignSheetHealthcareProvisions({
      decisions: {},
      hcp_anatomical_gift: null,
      hcp_anatomical_specified: '   ',
    }).client_anatomical_restrictions).toBeNull()
  })

  it('matches the spouse field, which is the asymmetry this closed', () => {
    const provisions = getDesignSheetHealthcareProvisions({
      decisions: {
        healthcare_provisions: {
          client_anatomical_restrictions: 'Client restriction.',
          spouse_anatomical_restrictions: 'Spouse restriction.',
        },
      },
      hcp_anatomical_gift: null,
    })
    expect(provisions.client_anatomical_restrictions).toBe('Client restriction.')
    expect(provisions.spouse_anatomical_restrictions).toBe('Spouse restriction.')
  })
})
