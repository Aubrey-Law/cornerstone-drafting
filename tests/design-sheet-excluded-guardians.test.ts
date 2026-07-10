import { describe, expect, it } from 'vitest'
import {
  getExcludedGuardians,
  getResolvedExcludedGuardians,
  setExcludedGuardians,
} from '@/lib/designSheet/excludedGuardians'
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

  it('resolves only selected contacts for draft payload', () => {
    const payload = draftPayloadExcludedGuardians(
      {
        decisions: {
          excluded_guardians: [
            { contact_id: 'contact-1', reason: 'estranged' },
            { contact_id: '', reason: null },
          ],
        },
        excluded_guardian_flag: true,
        excluded_guardian_name: null,
      },
      [{ id: 'contact-1', first_name: 'Alex', last_name: 'Unsafe' }],
    )

    expect(payload).toEqual([{ full_name: 'Alex Unsafe', reason: 'estranged' }])
  })
})
