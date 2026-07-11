import { describe, expect, it } from 'vitest'
import {
  formatExcludedGuardianName,
  getExcludedGuardians,
  getResolvedExcludedGuardians,
  setExcludedGuardians,
} from '@/lib/designSheet/excludedGuardians'
import type { DesignSheet, MatterContact } from '@/types/database'
import { draftPayloadExcludedGuardians } from '@/lib/draftPayload/excludedGuardians'

describe('excluded guardians design sheet helpers', () => {
  it('keeps in-progress rows without a selected contact for the UI', () => {
    const sheet = {
      decisions: {
        excluded_guardians: [
          { contact_id: 'contact-1', reason: 'estranged' },
          { contact_id: '', reason: null },
        ],
      },
    }

    expect(getExcludedGuardians(sheet)).toEqual([
      { contact_id: 'contact-1', reason: 'estranged' },
      { contact_id: '', reason: null },
    ])
    expect(getResolvedExcludedGuardians(sheet)).toEqual([
      { contact_id: 'contact-1', reason: 'estranged' },
    ])
  })

  it('round-trips excluded guardians through decisions', () => {
    const next = setExcludedGuardians(
      { decisions: {} },
      [
        { contact_id: 'contact-1', reason: 'estranged' },
        { contact_id: '', reason: null },
      ],
    )

    expect(getExcludedGuardians({ decisions: next })).toHaveLength(2)
  })

  it('formats excluded_guardian_name from the latest decisions state', () => {
    const contacts = [{ id: 'contact-1', first_name: 'Alex', last_name: 'Unsafe' }] as MatterContact[]
    let sheet: {
      excluded_guardian_flag: boolean
      excluded_guardian_name: string | null
      decisions: DesignSheet['decisions']
    } = {
      excluded_guardian_flag: true,
      excluded_guardian_name: null,
      decisions: {
        excluded_guardians: [{ contact_id: '', reason: null }],
      },
    }

    const nextDecisions = setExcludedGuardians(sheet, [
      { contact_id: 'contact-1', reason: 'estranged' },
    ])
    sheet = {
      ...sheet,
      decisions: nextDecisions,
      excluded_guardian_name: formatExcludedGuardianName(
        getExcludedGuardians({ decisions: nextDecisions }),
        contacts,
      ),
    }

    expect(getExcludedGuardians(sheet)).toEqual([
      { contact_id: 'contact-1', reason: 'estranged' },
    ])
    expect(sheet.excluded_guardian_name).toBe('Alex Unsafe — estranged')
  })
})
