/**
 * Facts about the settlors themselves that the interview form asks and no
 * column captures: a second address line, gender, where the marriage was
 * registered, which settlor is designated the survivor, whether the couple
 * lives together, and disabled-veteran status.
 *
 * These are `decisions.settlor_facts` rather than columns for the same reason
 * every namespace here is: a column costs a migration, a `types/supabase.ts`
 * regeneration and a PostgREST failure mode, and buys nothing these reads need.
 *
 * The two yes/no facts are `boolean | null`, not `boolean`. "Is the client a
 * disabled veteran?" is a question about a person, not a document opt-in — a
 * `false` default would print a ticked "No" on the interview worksheet for
 * every matter nobody has asked yet, which is a claim rather than a blank.
 */
import { readAllowedValue } from '@/lib/designSheet/decisionReaders'
import type { DesignSheet } from '@/types/database'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export type SettlorGender = 'male' | 'female' | 'nonbinary' | 'other'
export const SETTLOR_GENDERS: readonly SettlorGender[] =
  ['male', 'female', 'nonbinary', 'other'] as const

/** Which settlor the plan designates as the survivor for simultaneous death. */
export type SurvivorDesignation = 'settlor_1' | 'settlor_2' | 'both'
export const SURVIVOR_DESIGNATIONS: readonly SurvivorDesignation[] =
  ['settlor_1', 'settlor_2', 'both'] as const

export interface SettlorFacts {
  street_address_2: string | null
  client_gender: SettlorGender | null
  spouse_gender: SettlorGender | null
  place_of_marriage: string | null
  survivor_designation: SurvivorDesignation | null
  settlors_live_together: boolean | null
  disabled_veteran: boolean | null
}

const DEFAULT_SETTLOR_FACTS: SettlorFacts = {
  street_address_2: null,
  client_gender: null,
  spouse_gender: null,
  place_of_marriage: null,
  survivor_designation: null,
  settlors_live_together: null,
  disabled_veteran: null,
}

function settlorFactsRaw(sheet: Pick<DesignSheet, 'decisions'>): Record<string, unknown> {
  const decisions = isRecord(sheet.decisions) ? sheet.decisions : {}
  const raw = decisions.settlor_facts
  return isRecord(raw) ? raw : {}
}

function readText(raw: Record<string, unknown>, key: string): string | null {
  const value = raw[key]
  return typeof value === 'string' && value.trim() ? value : null
}

/** Yes, no, or not asked — the third state is what keeps the worksheet honest. */
function readTriBoolean(raw: Record<string, unknown>, key: string): boolean | null {
  return typeof raw[key] === 'boolean' ? (raw[key] as boolean) : null
}

export function getSettlorFacts(sheet: Pick<DesignSheet, 'decisions'>): SettlorFacts {
  const raw = settlorFactsRaw(sheet)

  return {
    street_address_2: readText(raw, 'street_address_2'),
    client_gender: readAllowedValue(raw, 'client_gender', SETTLOR_GENDERS),
    spouse_gender: readAllowedValue(raw, 'spouse_gender', SETTLOR_GENDERS),
    place_of_marriage: readText(raw, 'place_of_marriage'),
    survivor_designation: readAllowedValue(raw, 'survivor_designation', SURVIVOR_DESIGNATIONS),
    settlors_live_together: readTriBoolean(raw, 'settlors_live_together'),
    disabled_veteran: readTriBoolean(raw, 'disabled_veteran'),
  }
}

/** Spreads `...raw` first so a stored key this interface has not heard of survives. */
export function setSettlorFacts(
  sheet: Pick<DesignSheet, 'decisions'>,
  patch: Partial<SettlorFacts>,
) {
  const decisions = isRecord(sheet.decisions) ? sheet.decisions : {}
  const raw = settlorFactsRaw(sheet)
  const current = getSettlorFacts(sheet)

  return {
    ...decisions,
    settlor_facts: { ...raw, ...current, ...patch },
  }
}

export { DEFAULT_SETTLOR_FACTS }
