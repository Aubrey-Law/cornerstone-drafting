import type { DesignSheetKey } from './designSheetKeys'

export type FiduciaryRole = 'trustee' | 'executor' | 'poa' | 'hcp' | 'guardian' | 'temporary_guardian'

/** Intake JSONB / wizard local key for a fiduciary role list. */
export type FiduciaryIntakeSlotKey =
  | 'fid_personal_rep_client'
  | 'fid_trustee_client'
  | 'fid_poa_client'
  | 'fid_hcp_client'
  | 'fid_guardian_client'
  | 'fid_personal_rep_spouse'
  | 'fid_trustee_spouse'
  | 'fid_poa_spouse'
  | 'fid_hcp_spouse'

export type FiduciaryContactRole = 'personal_rep' | 'trustee' | 'poa' | 'hcp' | 'guardian'

export interface FiduciaryIntakeSlotDef {
  intakeKey: FiduciaryIntakeSlotKey
  /** Wizard state key, e.g. `_fid_trustee_client`. */
  intakeLocalKey: `_${FiduciaryIntakeSlotKey}`
  contactRole: FiduciaryContactRole
  forParty: 'client' | 'spouse'
  designSlotKey: DesignSheetKey
  designRole: FiduciaryRole
  label: string
  intakeStepId: 'fiduciaries' | 'spouse_fiduciaries' | 'guardian'
}

export const FIDUCIARY_INTAKE_SLOTS: FiduciaryIntakeSlotDef[] = [
  {
    intakeKey: 'fid_trustee_client',
    intakeLocalKey: '_fid_trustee_client',
    contactRole: 'trustee',
    forParty: 'client',
    designSlotKey: 'trustee_slots',
    designRole: 'trustee',
    label: 'Successor trustee',
    intakeStepId: 'fiduciaries',
  },
  {
    intakeKey: 'fid_personal_rep_client',
    intakeLocalKey: '_fid_personal_rep_client',
    contactRole: 'personal_rep',
    forParty: 'client',
    designSlotKey: 'executor_slots',
    designRole: 'executor',
    label: 'Personal representative',
    intakeStepId: 'fiduciaries',
  },
  {
    intakeKey: 'fid_poa_client',
    intakeLocalKey: '_fid_poa_client',
    contactRole: 'poa',
    forParty: 'client',
    designSlotKey: 'poa_slots',
    designRole: 'poa',
    label: 'Financial power of attorney',
    intakeStepId: 'fiduciaries',
  },
  {
    intakeKey: 'fid_hcp_client',
    intakeLocalKey: '_fid_hcp_client',
    contactRole: 'hcp',
    forParty: 'client',
    designSlotKey: 'hcp_slots',
    designRole: 'hcp',
    label: 'Health care proxy',
    intakeStepId: 'fiduciaries',
  },
  {
    intakeKey: 'fid_personal_rep_spouse',
    intakeLocalKey: '_fid_personal_rep_spouse',
    contactRole: 'personal_rep',
    forParty: 'spouse',
    designSlotKey: 'spouse_executor_slots',
    designRole: 'executor',
    label: "Spouse's personal representative",
    intakeStepId: 'spouse_fiduciaries',
  },
  {
    intakeKey: 'fid_poa_spouse',
    intakeLocalKey: '_fid_poa_spouse',
    contactRole: 'poa',
    forParty: 'spouse',
    designSlotKey: 'spouse_poa_slots',
    designRole: 'poa',
    label: "Spouse's financial power of attorney",
    intakeStepId: 'spouse_fiduciaries',
  },
  {
    intakeKey: 'fid_hcp_spouse',
    intakeLocalKey: '_fid_hcp_spouse',
    contactRole: 'hcp',
    forParty: 'spouse',
    designSlotKey: 'spouse_hcp_slots',
    designRole: 'hcp',
    label: "Spouse's health care proxy",
    intakeStepId: 'spouse_fiduciaries',
  },
  {
    intakeKey: 'fid_guardian_client',
    intakeLocalKey: '_fid_guardian_client',
    contactRole: 'guardian',
    forParty: 'client',
    designSlotKey: 'guardian_slots',
    designRole: 'guardian',
    label: 'Guardian for minors',
    intakeStepId: 'guardian',
  },
]

/** Map used by `fiduciaryEntriesToRoles` (intake JSONB slot key → contact role). */
export const FIDUCIARY_INTAKE_SLOT_MAP: Record<
  FiduciaryIntakeSlotKey,
  { role: FiduciaryContactRole; for_party: 'client' | 'spouse' }
> = Object.fromEntries(
  FIDUCIARY_INTAKE_SLOTS.map((slot) => [
    slot.intakeKey,
    { role: slot.contactRole, for_party: slot.forParty },
  ]),
) as Record<FiduciaryIntakeSlotKey, { role: FiduciaryContactRole; for_party: 'client' | 'spouse' }>

/** contact_roles.role → design_sheets slot column base (PR → executor). */
export const FIDUCIARY_CONTACT_ROLE_TO_DESIGN_BASE: Record<string, string> = {
  trustee: 'trustee',
  personal_rep: 'executor',
  executor: 'executor',
  poa: 'poa',
  hcp: 'hcp',
  guardian: 'guardian',
}

export const FIDUCIARY_DESIGN_SLOT_KEYS = new Set<string>([
  'trustee_slots',
  'executor_slots',
  'poa_slots',
  'hcp_slots',
  'guardian_slots',
  'spouse_trustee_slots',
  'spouse_executor_slots',
  'spouse_poa_slots',
  'spouse_hcp_slots',
])

export function designSlotKeyForContactRole(
  role: FiduciaryContactRole,
  forParty: 'client' | 'spouse',
): DesignSheetKey | null {
  const base = FIDUCIARY_CONTACT_ROLE_TO_DESIGN_BASE[role]
  if (!base) return null
  const key = forParty === 'spouse' ? `spouse_${base}_slots` : `${base}_slots`
  return FIDUCIARY_DESIGN_SLOT_KEYS.has(key) ? (key as DesignSheetKey) : null
}

export function getFiduciaryIntakeSlot(intakeKey: string): FiduciaryIntakeSlotDef | undefined {
  return FIDUCIARY_INTAKE_SLOTS.find((s) => s.intakeKey === intakeKey)
}

export function fiduciarySlotsForStep(stepId: string): FiduciaryIntakeSlotDef[] {
  return FIDUCIARY_INTAKE_SLOTS.filter((s) => s.intakeStepId === stepId)
}
