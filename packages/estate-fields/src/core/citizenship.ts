export type CitizenshipStatus =
  | 'unknown'
  | 'us_citizen'
  | 'permanent_resident'
  | 'nonresident_alien'
  | 'non_us_unspecified'
  | 'other'

export const CITIZENSHIP_STATUS_OPTIONS = [
  { value: 'unknown', label: 'Unknown / not confirmed' },
  { value: 'us_citizen', label: 'US Citizen' },
  { value: 'permanent_resident', label: 'Permanent Resident' },
  { value: 'nonresident_alien', label: 'Non-Resident Alien' },
  { value: 'non_us_unspecified', label: 'Non-US — status unconfirmed' },
  { value: 'other', label: 'Other' },
] as const satisfies ReadonlyArray<{ value: CitizenshipStatus; label: string }>

const CITIZENSHIP_STATUSES = new Set<CitizenshipStatus>(
  CITIZENSHIP_STATUS_OPTIONS.map(option => option.value),
)

export function citizenshipStatusFromLegacyBoolean(
  value: boolean | null | undefined,
): CitizenshipStatus {
  if (value === true) return 'us_citizen'
  if (value === false) return 'non_us_unspecified'
  return 'unknown'
}

export function normalizeCitizenshipStatus(
  raw: unknown,
  legacyBoolean?: boolean | null,
): CitizenshipStatus {
  if (typeof raw === 'string' && CITIZENSHIP_STATUSES.has(raw as CitizenshipStatus)) {
    return raw as CitizenshipStatus
  }
  return citizenshipStatusFromLegacyBoolean(legacyBoolean)
}

export function citizenshipStatusToLegacyBoolean(
  status: CitizenshipStatus,
): boolean | null {
  if (status === 'us_citizen') return true
  if (
    status === 'permanent_resident'
    || status === 'nonresident_alien'
    || status === 'non_us_unspecified'
  ) return false
  return null
}

export function citizenshipDesignLabel(status: CitizenshipStatus): string | null {
  if (status === 'unknown') return null
  return CITIZENSHIP_STATUS_OPTIONS.find(option => option.value === status)?.label ?? null
}

export function citizenshipStatusFromDesignLabel(raw: unknown): CitizenshipStatus {
  if (typeof raw !== 'string' || !raw.trim()) return 'unknown'
  const normalized = raw.trim().toLowerCase()
  if (normalized === 'us citizen' || normalized === 'u.s. citizen') return 'us_citizen'
  if (normalized.includes('permanent')) return 'permanent_resident'
  if (normalized === 'non-resident alien' || normalized === 'nonresident alien') {
    return 'nonresident_alien'
  }
  if (normalized.includes('non-us') || normalized.includes('status unconfirmed')) {
    return 'non_us_unspecified'
  }
  return 'other'
}

export function citizenshipDesignLabelFromLegacyBoolean(
  value: boolean | null | undefined,
): string | null {
  return citizenshipDesignLabel(citizenshipStatusFromLegacyBoolean(value))
}
