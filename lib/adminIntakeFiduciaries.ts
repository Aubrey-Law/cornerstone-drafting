import type { AdminIntakeFormData } from '@/types/adminIntake'

// ─────────────────────────────────────────────────────────────────────────────
// Maps the admin "Fill Intake" sheet's flat fiduciary text fields onto the
// shared contacts / contact_roles model that document drafting reads from
// (see lib/buildDraftPayload.ts). The client-portal wizard already persists
// fiduciaries this way; the admin sheet historically collected them as plain
// text boxes that were never saved. These helpers bridge the two.
//
// Convention (mirrors components/intake/IntakeWizard.tsx):
//   • Principals are is_coagent=false. priority 1 = primary, 2 = alternate.
//   • for_party is always 'client' — the admin sheet only captures the
//     client's own fiduciaries (guardian included).
// ─────────────────────────────────────────────────────────────────────────────

type FlatField = keyof AdminIntakeFormData

export const ADMIN_FIDUCIARY_FIELD_MAP: Array<{
  field: FlatField
  pronounField: FlatField
  role: string
  priority: number
}> = [
  { field: 'trustee_primary', pronounField: 'trustee_primary_pronouns', role: 'trustee', priority: 1 },
  { field: 'trustee_alternate', pronounField: 'trustee_alternate_pronouns', role: 'trustee', priority: 2 },
  { field: 'executor_primary', pronounField: 'executor_primary_pronouns', role: 'personal_rep', priority: 1 },
  { field: 'executor_alternate', pronounField: 'executor_alternate_pronouns', role: 'personal_rep', priority: 2 },
  { field: 'poa_primary', pronounField: 'poa_primary_pronouns', role: 'poa', priority: 1 },
  { field: 'poa_alternate', pronounField: 'poa_alternate_pronouns', role: 'poa', priority: 2 },
  { field: 'hcp_primary', pronounField: 'hcp_primary_pronouns', role: 'hcp', priority: 1 },
  { field: 'hcp_alternate', pronounField: 'hcp_alternate_pronouns', role: 'hcp', priority: 2 },
  { field: 'guardian_primary', pronounField: 'guardian_primary_pronouns', role: 'guardian', priority: 1 },
  { field: 'guardian_alternate', pronounField: 'guardian_alternate_pronouns', role: 'guardian', priority: 2 },
]

/** The roles the admin sheet manages, at priorities 1 (primary) and 2 (alt). */
export const ADMIN_FIDUCIARY_ROLES = ['trustee', 'personal_rep', 'poa', 'hcp', 'guardian'] as const
export const ADMIN_FIDUCIARY_PRIORITIES = [1, 2] as const

export function splitFiduciaryName(name: string): { first_name: string; last_name: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { first_name: '', last_name: '' }
  if (parts.length === 1) return { first_name: parts[0], last_name: '' }
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') }
}

export function joinFiduciaryName(first: unknown, last: unknown): string {
  return [first, last]
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean)
    .join(' ')
}

export interface AdminFiduciaryEntry {
  role: string
  for_party: 'client'
  priority: number
  first_name: string
  last_name: string
  preferred_pronoun: string | null
}

/** Non-empty fiduciary fields from the form, as contact_roles-ready entries. */
export function adminFiduciaryEntriesFromForm(data: AdminIntakeFormData): AdminFiduciaryEntry[] {
  const entries: AdminFiduciaryEntry[] = []
  for (const { field, pronounField, role, priority } of ADMIN_FIDUCIARY_FIELD_MAP) {
    const raw = data[field]
    const name = typeof raw === 'string' ? raw.trim() : ''
    if (!name) continue
    const rawPronoun = data[pronounField]
    const pronoun = typeof rawPronoun === 'string' ? rawPronoun.trim() : ''
    const { first_name, last_name } = splitFiduciaryName(name)
    entries.push({
      role,
      for_party: 'client',
      priority,
      first_name,
      last_name,
      preferred_pronoun: pronoun || null,
    })
  }
  return entries
}

export interface AdminFiduciaryRoleRow {
  role: string
  for_party: string
  priority: number | null
  is_coagent?: boolean | null
  first_name: string | null
  last_name: string | null
  preferred_pronoun?: string | null
}

/** Rebuild the flat fiduciary fields from contact_roles joined to contacts,
 *  so the admin sheet round-trips what drafting stores. Only principals
 *  (is_coagent=false) at priority 1/2 map back to the flat boxes. */
export function adminFiduciaryFlatFromRoles(
  rows: AdminFiduciaryRoleRow[],
): Partial<Record<FlatField, string>> {
  const out: Partial<Record<FlatField, string>> = {}
  for (const { field, pronounField, role, priority } of ADMIN_FIDUCIARY_FIELD_MAP) {
    const match = rows.find(
      (r) =>
        r.role === role &&
        r.for_party === 'client' &&
        !r.is_coagent &&
        (r.priority ?? 1) === priority,
    )
    if (match) {
      out[field] = joinFiduciaryName(match.first_name, match.last_name)
      out[pronounField] = (match.preferred_pronoun ?? '').trim()
    }
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Probate (pb_*) fields have no dedicated columns; they live in a
// client_intake.probate_details jsonb (added 2026-06). Stored without the
// pb_ prefix to keep the blob clean.
// ─────────────────────────────────────────────────────────────────────────────

export const ADMIN_PROBATE_FIELD_MAP: Array<{ field: FlatField; key: string }> = [
  { field: 'pb_decedent_name', key: 'decedent_name' },
  { field: 'pb_date_of_death', key: 'date_of_death' },
  { field: 'pb_domicile', key: 'domicile' },
  { field: 'pb_estate_value', key: 'estate_value' },
  { field: 'pb_known_assets', key: 'known_assets' },
  { field: 'pb_known_debts', key: 'known_debts' },
  { field: 'pb_petitioner_relationship', key: 'petitioner_relationship' },
  { field: 'pb_goals_timeline', key: 'goals_timeline' },
]

export function probateDetailsFromForm(data: AdminIntakeFormData): Record<string, string> | null {
  const out: Record<string, string> = {}
  for (const { field, key } of ADMIN_PROBATE_FIELD_MAP) {
    const raw = data[field]
    const val = typeof raw === 'string' ? raw.trim() : ''
    if (val) out[key] = val
  }
  return Object.keys(out).length > 0 ? out : null
}

export function probateFlatFromDetails(details: unknown): Partial<Record<FlatField, string>> {
  const out: Partial<Record<FlatField, string>> = {}
  if (!details || typeof details !== 'object') return out
  const rec = details as Record<string, unknown>
  for (const { field, key } of ADMIN_PROBATE_FIELD_MAP) {
    const v = rec[key]
    if (typeof v === 'string') out[field] = v
  }
  return out
}
