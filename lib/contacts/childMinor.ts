import { ageInYearsFromDob } from '@/lib/dob'

/** True when the DOB implies an age under 18. Null/blank DOB → false.
 * DOB must be an ISO-8601 date string; the age boundary is evaluated in UTC. */
export function isMinorFromDob(dob: string | null): boolean {
  const age = ageInYearsFromDob(dob)
  return age !== null && age < 18
}

/**
 * Decide the stored `is_minor` override. We only persist a value when the
 * caller's effective flag disagrees with the DOB derivation; otherwise null
 * keeps it derived. `undefined` means the caller has no opinion → derived.
 */
export function resolveIsMinor(
  value: boolean | undefined,
  dob: string | null,
): boolean | null {
  // Load-bearing: undefined !== a boolean, so without this guard the line below would return undefined.
  if (value === undefined) return null
  return value === isMinorFromDob(dob) ? null : value
}
