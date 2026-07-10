import type { HouseholdChildInput } from './childMapping'
import type { HouseholdPerson } from './getHousehold'
import { parentageFromIntakeParent } from './parentageFromIntake'

/**
 * Merge a raw children-save payload entry with the matching existing contacts
 * row, preserving attorney-set relationship/parentage/is_minor when the caller
 * doesn't supply them.
 */
export interface MergeChildInputContext {
  clientFirstName?: string | null
  spouseFirstName?: string | null
}

export function mergeChildInput(
  raw: Record<string, unknown>,
  existing: HouseholdPerson | undefined,
  context: MergeChildInputContext = {},
): HouseholdChildInput {
  const cid = typeof raw.contact_id === 'string' ? raw.contact_id : null
  const suppliedRel =
    typeof raw.relationship === 'string'
      ? (raw.relationship as 'biological' | 'adopted' | 'stepchild')
      : undefined
  const suppliedParentage = raw.parentage as
    | 'joint'
    | 'client'
    | 'spouse'
    | null
    | undefined
  const parentageFromWizard =
    suppliedParentage !== undefined
      ? suppliedParentage
      : raw.parent !== undefined
        ? parentageFromIntakeParent(raw.parent, context.clientFirstName, context.spouseFirstName)
        : undefined

  return {
    contact_id: cid,
    first_name: (raw.first_name as string) ?? '',
    last_name: (raw.last_name as string) ?? '',
    middle_name: (raw.middle_name as string) ?? null,
    dob: (raw.date_of_birth as string) || null,
    relationship: suppliedRel ?? existing?.child_relationship ?? 'biological',
    parentage:
      parentageFromWizard !== undefined ? parentageFromWizard : (existing?.parentage ?? null),
    is_minor:
      typeof raw.is_minor === 'boolean'
        ? raw.is_minor
        : existing
          ? existing.is_minor
          : undefined,
    email: (raw.email as string) ?? null,
    phone: typeof raw.phone === 'string' ? raw.phone : null,
    same_address: Boolean(raw.same_address),
    address_line1: (raw.address_line1 as string) ?? null,
  }
}
