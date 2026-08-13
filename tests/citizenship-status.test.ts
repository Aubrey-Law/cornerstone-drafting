import { describe, expect, it } from 'vitest'
import {
  citizenshipDesignLabel,
  citizenshipStatusFromDesignLabel,
  citizenshipStatusFromLegacyBoolean,
  citizenshipStatusToLegacyBoolean,
  normalizeCitizenshipStatus,
} from '@aubrey-law/estate-fields'

describe('citizenship status', () => {
  it.each([
    [true, 'us_citizen'],
    [false, 'non_us_unspecified'],
    [null, 'unknown'],
    [undefined, 'unknown'],
  ] as const)('conservatively converts legacy boolean %s', (input, expected) => {
    expect(citizenshipStatusFromLegacyBoolean(input)).toBe(expected)
  })

  it.each([
    ['us_citizen', 'US Citizen'],
    ['permanent_resident', 'Permanent Resident'],
    ['nonresident_alien', 'Non-Resident Alien'],
    ['non_us_unspecified', 'Non-US — status unconfirmed'],
    ['unknown', null],
  ] as const)('maps %s to its design-sheet representation', (status, expected) => {
    expect(citizenshipDesignLabel(status)).toBe(expected)
  })

  it('round-trips permanent residence and preserves an unknown blank', () => {
    expect(citizenshipStatusFromDesignLabel('Permanent Resident')).toBe('permanent_resident')
    expect(citizenshipStatusFromDesignLabel('')).toBe('unknown')
    expect(citizenshipStatusFromDesignLabel(null)).toBe('unknown')
  })

  it('prefers a valid status and otherwise falls back to the legacy answer', () => {
    expect(normalizeCitizenshipStatus('permanent_resident', true)).toBe('permanent_resident')
    expect(normalizeCitizenshipStatus('invalid', false)).toBe('non_us_unspecified')
  })

  it('only mirrors statuses with an unambiguous US-citizenship answer', () => {
    expect(citizenshipStatusToLegacyBoolean('us_citizen')).toBe(true)
    expect(citizenshipStatusToLegacyBoolean('permanent_resident')).toBe(false)
    expect(citizenshipStatusToLegacyBoolean('nonresident_alien')).toBe(false)
    expect(citizenshipStatusToLegacyBoolean('non_us_unspecified')).toBe(false)
    expect(citizenshipStatusToLegacyBoolean('unknown')).toBeNull()
    expect(citizenshipStatusToLegacyBoolean('other')).toBeNull()
  })
})
