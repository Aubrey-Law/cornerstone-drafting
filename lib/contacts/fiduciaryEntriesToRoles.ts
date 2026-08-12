/**
 * Pure mapper: convert the legacy `client_intake.fiduciary_entries` JSONB shape
 * into a flat list of contact_roles-ready entries.
 *
 * JSONB shape (per the wizard at components/intake/IntakeWizard.tsx and the
 * intake POST handler at app/api/intake/route.ts):
 *
 *   {
 *     fid_personal_rep_client: [{ first_name, last_name, email?, phone?, ... }, ...],
 *     fid_poa_client:          [...],
 *     fid_hcp_client:          [...],
 *     fid_trustee_client:      [...],
 *     fid_guardian_client:     [...],
 *     fid_personal_rep_spouse: [...],
 *     fid_poa_spouse:          [...],
 *     fid_hcp_spouse:          [...],
 *   }
 *
 * The slot key encodes role + for_party. The array index encodes priority
 * (index 0 -> priority 1 = primary, index 1 -> priority 2 = alternate).
 *
 * F1 only handles the 5 admin-managed roles at priorities 1-2 and treats
 * every entry as `is_coagent: false`. Co-agents and higher priorities are
 * F2+ territory.
 */

import { FIDUCIARY_INTAKE_SLOT_MAP } from '@/lib/sharedFields/fiduciaries'

export type FiduciaryRole = 'personal_rep' | 'trustee' | 'poa' | 'hcp' | 'guardian'
export type FiduciaryForParty = 'client' | 'spouse'

export interface FiduciaryRoleEntry {
  role: FiduciaryRole
  for_party: FiduciaryForParty
  priority: number
  is_coagent: boolean
  first_name: string
  last_name: string
  middle_name?: string | null
  email?: string | null
  phone?: string | null
  preferred_pronoun?: string | null
  relationship_label?: string | null
}

// slot key -> { role, for_party } — shared registry (lib/sharedFields/fiduciaries.ts)
const SLOT_MAP = FIDUCIARY_INTAKE_SLOT_MAP

const MAX_PRIORITY = 2

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function nullableString(value: unknown): string | null {
  const t = trimString(value)
  return t.length > 0 ? t : null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function fiduciaryEntriesToRoles(input: unknown): FiduciaryRoleEntry[] {
  if (!isPlainObject(input)) return []

  const out: FiduciaryRoleEntry[] = []

  for (const [slotKey, slotInfo] of Object.entries(SLOT_MAP)) {
    const arr = (input as Record<string, unknown>)[slotKey]
    if (!Array.isArray(arr)) continue

    arr.forEach((raw, idx) => {
      const priority = idx + 1
      if (priority > MAX_PRIORITY) return

      if (!isPlainObject(raw)) return
      const first_name = trimString(raw.first_name)
      const last_name = trimString(raw.last_name)
      if (!first_name && !last_name) return

      out.push({
        role: slotInfo.role,
        for_party: slotInfo.for_party,
        priority,
        is_coagent: false,
        first_name,
        last_name,
        middle_name: nullableString(raw.middle_name),
        email: nullableString(raw.email),
        phone: nullableString(raw.phone),
        preferred_pronoun: nullableString(raw.preferred_pronoun ?? raw.pronouns),
        relationship_label: nullableString(raw.relationship_label ?? raw.relationship),
      })
    })
  }

  return out
}

export function fiduciaryEntriesTouchesManagedRoles(input: unknown): boolean {
  if (!isPlainObject(input)) return false
  return Object.keys(SLOT_MAP).some((slotKey) =>
    Object.prototype.hasOwnProperty.call(input, slotKey),
  )
}
