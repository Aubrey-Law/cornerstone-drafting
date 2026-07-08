import type { DesignSheetChild } from '@/types/database'
import { formatPhoneForStorage } from '@/lib/phone'
import { composedAddressOneLine } from '@/lib/intakeContactAddress'
import { isMinorFromDob, resolveIsMinor } from './childMinor'
import { splitName, joinName } from './childName'

export interface HouseholdChildInput {
  contact_id?: string | null
  /** Single display name (JSON paths). Optional when structured names are given. */
  name?: string
  first_name?: string
  middle_name?: string | null
  last_name?: string
  dob: string | null
  relationship: DesignSheetChild['relationship']
  parentage?: DesignSheetChild['parentage']
  /** Effective minor flag from the caller; writer decides override vs derived. */
  is_minor?: boolean
  gender?: DesignSheetChild['gender']
  deceased?: boolean
  email?: string | null
  phone?: string | null
  same_address?: boolean
  address_line1?: string | null
}

type IntakeAddr = { address_line1?: unknown; city?: unknown; state?: unknown; zip?: unknown } | null

const VALID_REL = new Set<DesignSheetChild['relationship']>(['biological', 'adopted', 'stepchild'])

function nullable(v: string | null | undefined): string | null {
  if (typeof v !== 'string') return v ?? null
  const t = v.trim()
  return t === '' ? null : t
}

export function childInputToContactPayload(input: HouseholdChildInput, intake: IntakeAddr): Record<string, unknown> {
  const hasStructured = input.first_name !== undefined || input.last_name !== undefined
  const { first, middle, last } = hasStructured
    ? { first: input.first_name ?? '', middle: input.middle_name ?? null, last: input.last_name ?? '' }
    : splitName(input.name ?? '')

  const sameAddr = Boolean(input.same_address)
  const address_line1 = sameAddr && intake
    ? composedAddressOneLine({
        street: typeof intake.address_line1 === 'string' ? intake.address_line1 : '',
        city: typeof intake.city === 'string' ? intake.city : '',
        state: typeof intake.state === 'string' ? intake.state : '',
        zip: typeof intake.zip === 'string' ? intake.zip : '',
      })
    : nullable(input.address_line1)

  return {
    relationship_type: 'child',
    relationship_label: 'Child',
    first_name: (first ?? '').trim(),
    middle_name: nullable(middle),
    last_name: (last ?? '').trim(),
    date_of_birth: nullable(input.dob),
    child_relationship: input.relationship && VALID_REL.has(input.relationship) ? input.relationship : null,
    parentage: input.parentage ?? null,
    is_minor: resolveIsMinor(input.is_minor, input.dob),
    email: nullable(input.email),
    phone: formatPhoneForStorage(typeof input.phone === 'string' ? input.phone : ''),
    address_line1,
  }
}

export function contactRowToDesignSheetChild(row: Record<string, unknown>): DesignSheetChild {
  const dob = (row.date_of_birth as string | null) ?? null
  const override = row.is_minor as boolean | null | undefined
  const rel = row.child_relationship as DesignSheetChild['relationship'] | null
  return {
    name: joinName(row.first_name as string | null, row.last_name as string | null) ?? '',
    dob,
    gender: (row.gender as DesignSheetChild['gender']) ?? null,
    deceased: Boolean(row.deceased),
    relationship: rel && VALID_REL.has(rel) ? rel : 'biological',
    parentage: (row.parentage as DesignSheetChild['parentage']) ?? null,
    is_minor: typeof override === 'boolean' ? override : isMinorFromDob(dob),
  }
}
