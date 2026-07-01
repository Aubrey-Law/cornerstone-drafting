import type { DesignSheetChild } from '@/types/database'
import { parseDob } from '@/lib/dob'

const MIN_YOUNG_ADULT_AGE = 17.5
const MAX_YOUNG_ADULT_AGE = 25
const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000

export function fractionalAgeFromDob(value: string | null | undefined, now = new Date()): number | null {
  const dob = parseDob(value)
  if (!dob) return null
  return (now.getTime() - dob.getTime()) / MS_PER_YEAR
}

export function isYoungAdultEstatePlanAge(value: string | null | undefined, now = new Date()): boolean {
  const age = fractionalAgeFromDob(value, now)
  return age !== null && age >= MIN_YOUNG_ADULT_AGE && age <= MAX_YOUNG_ADULT_AGE
}

export function hasYoungAdultEstatePlanChild(
  children: Array<Pick<DesignSheetChild, 'dob'>> | null | undefined,
  now = new Date(),
): boolean {
  return (children ?? []).some(child => isYoungAdultEstatePlanAge(child.dob, now))
}
