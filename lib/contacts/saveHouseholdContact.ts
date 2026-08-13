import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { formatPhoneForStorage } from '@/lib/phone'
import type { CitizenshipStatus } from '@/lib/sharedFields'

type AdminClient = SupabaseClient<Database>

export type HouseholdRelationship = 'self' | 'spouse' | 'child' | 'other'

export interface HouseholdContactInput {
  householdId: string
  relationship_type: HouseholdRelationship
  contact_id?: string | null
  first_name: string
  last_name: string
  middle_name?: string | null
  suffix?: string | null
  preferred_name?: string | null
  preferred_pronoun?: string | null
  prior_names?: string | null
  date_of_birth?: string | null
  is_us_citizen?: boolean | null
  citizenship_status?: CitizenshipStatus | null
  email?: string | null
  phone?: string | null
  address_line1?: string | null
  address_line2?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  county?: string | null
  source?: string | null
  mode?: 'replace' | 'fill'
}

const FILL_SUPPLEMENTAL_FIELDS = [
  'middle_name', 'suffix', 'preferred_name', 'preferred_pronoun', 'prior_names',
  'date_of_birth', 'is_us_citizen', 'citizenship_status', 'email', 'phone',
  'address_line1', 'address_line2', 'city', 'state', 'zip', 'county',
] as const

function isEmptyValue(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
}

function coalesceSupplemental(
  payload: Record<string, unknown>,
  existing: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...payload }
  for (const field of FILL_SUPPLEMENTAL_FIELDS) {
    if (isEmptyValue(merged[field]) && !isEmptyValue(existing[field])) {
      merged[field] = existing[field]
    }
  }
  return merged
}

const LABELS: Record<HouseholdRelationship, string> = {
  self: 'Self',
  spouse: 'Spouse',
  child: 'Child',
  other: 'Other',
}

function nullable(v: string | null | undefined): string | null {
  if (typeof v !== 'string') return v ?? null
  const t = v.trim()
  return t === '' ? null : t
}

function buildPayload(input: HouseholdContactInput): Record<string, unknown> {
  return {
    client_intake_id: input.householdId,
    relationship_type: input.relationship_type,
    relationship_label: LABELS[input.relationship_type],
    first_name: input.first_name.trim(),
    last_name: input.last_name.trim(),
    middle_name: nullable(input.middle_name),
    suffix: nullable(input.suffix),
    preferred_name: nullable(input.preferred_name),
    preferred_pronoun: nullable(input.preferred_pronoun),
    prior_names: nullable(input.prior_names),
    date_of_birth: nullable(input.date_of_birth),
    is_us_citizen: typeof input.is_us_citizen === 'boolean' ? input.is_us_citizen : null,
    citizenship_status: input.citizenship_status ?? null,
    email: nullable(input.email),
    phone: formatPhoneForStorage(typeof input.phone === 'string' ? input.phone : ''),
    address_line1: nullable(input.address_line1),
    address_line2: nullable(input.address_line2),
    city: nullable(input.city),
    state: nullable(input.state),
    zip: nullable(input.zip),
    county: nullable(input.county),
    source: nullable(input.source) ?? 'attorney_intake',
    updated_at: new Date().toISOString(),
  }
}

/** Authoritative writer for a person in a household (spouse/child/other). */
export async function saveHouseholdContact(
  admin: AdminClient,
  input: HouseholdContactInput,
): Promise<{ id: string }> {
  const payload = buildPayload(input)
  const isSingleton = input.relationship_type === 'self' || input.relationship_type === 'spouse'
  const fillMode = input.mode === 'fill'

  let existingId: string | null = null
  let existingRow: Record<string, unknown> | null = null
  if (isSingleton) {
    const { data } = await admin
      .from('contacts')
      .select(fillMode ? '*' : 'id')
      .eq('client_intake_id', input.householdId)
      .eq('relationship_type', input.relationship_type)
      .maybeSingle()
    existingRow = (data as Record<string, unknown> | null) ?? null
    existingId = (existingRow?.id as string | undefined) ?? null
  } else if (input.contact_id) {
    existingId = input.contact_id
    if (fillMode) {
      const { data } = await admin
        .from('contacts')
        .select('*')
        .eq('id', input.contact_id)
        .maybeSingle()
      existingRow = (data as Record<string, unknown> | null) ?? null
    }
  }

  let resultId: string
  if (existingId) {
    const updatePayload =
      fillMode && existingRow ? coalesceSupplemental(payload, existingRow) : payload
    const { error } = await admin.from('contacts').update(updatePayload).eq('id', existingId)
    if (error) throw new Error(`${error.code ?? 'error'}: ${error.message}`)
    resultId = existingId
  } else {
    const { data, error } = await admin
      .from('contacts')
      .insert(payload)
      .select('id')
      .single()
    if (error) throw new Error(`${error.code ?? 'error'}: ${error.message}`)
    resultId = (data as { id: string }).id
  }

  return { id: resultId }
}
