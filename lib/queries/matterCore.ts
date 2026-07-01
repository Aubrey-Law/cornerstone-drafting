import { createServerSupabase } from '@/lib/supabaseServer'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { inflateDesignSheetRow } from '@/lib/designSheetPersistence'
import { formatPhoneDisplay } from '@/lib/phone'
import { loadSpouseContact } from '@/lib/contacts/loadSpouseContact'
import { loadHouseholdChildren } from '@/lib/contacts/loadHouseholdChildren'
import type { PipelineMatter, DesignSheet, MatterContact } from '@/types/database'

function normalizeFlags(m: PipelineMatter): PipelineMatter {
  const raw = m.flags as unknown
  if (raw == null) return { ...m, flags: null }
  if (Array.isArray(raw)) return m
  if (typeof raw === 'string') {
    if (raw.startsWith('{') && raw.endsWith('}')) {
      const inner = raw.slice(1, -1).trim()
      if (!inner) return { ...m, flags: [] }
      const items = inner.split(',').map(s => s.trim().replace(/^"|"$/g, ''))
      return { ...m, flags: items }
    }
    return { ...m, flags: raw ? [raw] : [] }
  }
  return { ...m, flags: [] }
}

const PIPELINE_MATTER_COLUMNS =
  'matter_id, matter_name, stage, status, flags, matter_created, client_name, client_email, client_phone, client_dob, client_address, spouse_name, spouse_email, spouse_phone, spouse_dob, spouse_address, plan_type, marital_status, has_minor_children, taxable_estate, intake_status, intake_sent_at, design_status, intake_submitted_at, drafts_sent_at, signing_date, documents_executed_at, next_appointment, next_appointment_type, practice_area, referral_source, fee_amount, opened_at, client_status' as const

export async function fetchMatter(id: string): Promise<PipelineMatter | null> {
  const supabase = getAdminClient()
  const { data, error } = await supabase
    .from('v_matter_pipeline')
    .select(PIPELINE_MATTER_COLUMNS)
    .eq('matter_id', id)
    .single()

  if (error) {
    console.error('fetchMatter error:', error)
    return null
  }
  return data
    ? normalizeFlags({
        ...data,
        client_phone: formatPhoneDisplay(data.client_phone),
        spouse_phone: formatPhoneDisplay(data.spouse_phone),
      })
    : null
}

export async function fetchDesignSheet(matterId: string): Promise<DesignSheet | null> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('design_sheets')
    .select('*')
    .eq('matter_id', matterId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('fetchDesignSheet error:', error)
    return null
  }
  return inflateDesignSheetRow((data ?? null) as Record<string, unknown> | null)
}

export async function fetchMatterContacts(matterId: string): Promise<MatterContact[]> {
  const admin = getAdminClient()
  const { data: matter } = await admin
    .from('matters')
    .select('client_intake_id')
    .eq('id', matterId)
    .maybeSingle()

  if (!matter?.client_intake_id) return []

  const { data, error } = await admin
    .from('contacts')
    .select('id, first_name, middle_name, last_name, relationship_type, relationship_label, phone, email, address_line1')
    .eq('client_intake_id', matter.client_intake_id)
    .order('last_name', { ascending: true })
    .limit(200)

  if (error) {
    console.error('fetchMatterContacts error:', error)
    return []
  }

  return (data ?? []).map(c => ({
    id: c.id,
    first_name: c.first_name,
    middle_name: c.middle_name ?? null,
    last_name: c.last_name,
    relationship: c.relationship_label ?? c.relationship_type,
    phone: formatPhoneDisplay(c.phone),
    email: c.email,
    address: c.address_line1,
  }))
}

export interface IntakeSnapshot {
  first_name: string | null
  middle_name: string | null
  last_name: string | null
  suffix: string | null
  date_of_birth: string | null
  phone: string | null
  email: string | null
  address_line1: string | null
  city: string | null
  state: string | null
  zip: string | null
  county: string | null
  marital_status: string | null
  preferred_pronoun: string | null
  spouse_first_name: string | null
  spouse_middle_name: string | null
  spouse_last_name: string | null
  spouse_date_of_birth: string | null
  spouse_phone: string | null
  spouse_email: string | null
  spouse_preferred_pronoun: string | null
  date_of_marriage: string | null
  children: Array<{ name: string; date_of_birth: string | null; relationship: string }> | null
  has_minor_children: boolean | null
  planning_objectives: string | null
  special_circumstances: string[] | null
  special_notes: string | null
  has_will: boolean | null
  has_trust: boolean | null
  has_poa: boolean | null
  has_hcp: boolean | null
  estate_value: string | null
  has_real_property: boolean | null
  real_property_address: string | null
  real_property_value: string | null
  has_retirement: boolean | null
  retirement_value: string | null
  has_life_insurance: boolean | null
  life_insurance_value: string | null
  has_business: boolean | null
  business_description: string | null
  has_investments: boolean | null
  trustee_primary: string | null
  trustee_alternate: string | null
  executor_primary: string | null
  executor_alternate: string | null
  poa_primary: string | null
  poa_alternate: string | null
  hcp_primary: string | null
  hcp_alternate: string | null
  guardian_primary: string | null
  guardian_alternate: string | null
  goals_extended: { primaryGoals: string[]; specialConsiderations: string; wishesAndConcerns: string } | null
  real_estate_extended: Array<{ address: string; ownership: string; estimatedValue: string; hasMortgage: boolean }> | null
  financial_accounts: Array<{ institution: string; accountType: string; approximateValue: string }> | null
  beneficiaries: Array<{ fullName: string; relationship: string; percentage: string }> | null
}

export async function fetchIntakeForMatter(matterId: string): Promise<IntakeSnapshot | null> {
  const admin = getAdminClient()

  const [matterRow, noteRow] = await Promise.all([
    admin.from('matters').select('client_intake_id').eq('id', matterId).maybeSingle(),
    admin.from('matter_notes').select('body').eq('matter_id', matterId).eq('note_type', 'intake_data').maybeSingle(),
  ])

  const clientIntakeId = (matterRow.data?.client_intake_id ?? null) as string | null

  let ai: Record<string, unknown> = {}
  let spouse: Awaited<ReturnType<typeof loadSpouseContact>> = null
  let householdChildren: Awaited<ReturnType<typeof loadHouseholdChildren>> = []
  if (clientIntakeId) {
    const [{ data }, spouseContact, childContacts] = await Promise.all([
      admin.from('client_intake').select('*').eq('id', clientIntakeId).maybeSingle(),
      loadSpouseContact(admin, clientIntakeId),
      loadHouseholdChildren(admin, clientIntakeId),
    ])
    if (data) ai = data as Record<string, unknown>
    spouse = spouseContact
    householdChildren = childContacts
  }

  let ext: Record<string, unknown> = {}
  const rawContent = noteRow.data?.body
  if (rawContent) {
    try {
      ext = JSON.parse(rawContent as string) as Record<string, unknown>
    } catch {
      /* ignore */
    }
  }

  if (Object.keys(ai).length === 0 && Object.keys(ext).length === 0) return null

  const fd = (ai.financial_details ?? {}) as Record<string, unknown>

  const children = householdChildren.length
    ? householdChildren.map(c => ({
        name: c.name,
        date_of_birth: c.dob,
        relationship: c.relationship,
      }))
    : null

  return {
    first_name: (ai.first_name as string) || null,
    middle_name: (ai.middle_name as string) || null,
    last_name: (ai.last_name as string) || null,
    suffix: (ai.suffix as string) || null,
    date_of_birth: (ai.date_of_birth as string) || null,
    phone: formatPhoneDisplay(ai.phone as string) || null,
    email: (ai.email as string) || null,
    address_line1: (ai.address_line1 as string) || null,
    city: (ai.city as string) || null,
    state: (ai.state as string) || null,
    zip: (ai.zip as string) || null,
    county: (ai.county as string) || null,
    marital_status: (ai.marital_status as string) || null,
    preferred_pronoun: (ai.preferred_pronoun as string) || null,
    spouse_first_name: spouse?.first_name || null,
    spouse_middle_name: spouse?.middle_name || null,
    spouse_last_name: spouse?.last_name || null,
    spouse_date_of_birth: spouse?.date_of_birth || null,
    spouse_phone: formatPhoneDisplay(spouse?.phone ?? '') || null,
    spouse_email: spouse?.email || null,
    spouse_preferred_pronoun: spouse?.preferred_pronoun || null,
    date_of_marriage: (ai.date_of_marriage as string) || null,
    children: children?.length ? children : null,
    has_minor_children: (ai.has_minor_children as boolean) ?? null,
    planning_objectives: (ai.planning_objectives as string) || null,
    special_circumstances: (ai.special_circumstances as string[]) || null,
    special_notes: (ai.special_notes as string) || null,
    has_will: (ai.has_will as boolean) ?? null,
    has_trust: (ai.has_trust as boolean) ?? null,
    has_poa: (ai.has_poa as boolean) ?? null,
    has_hcp: (ai.has_hcp as boolean) ?? null,
    estate_value: (ai.estate_value as string) || null,
    has_real_property: (ai.has_real_property as boolean) ?? null,
    real_property_address: (fd.real_property_address as string) || (ai.real_property_address as string) || null,
    real_property_value: (fd.real_property_value as string) || (ai.real_property_value as string) || null,
    has_retirement: (ai.has_retirement as boolean) ?? null,
    retirement_value: (fd.retirement_value as string) || (ai.retirement_value as string) || null,
    has_life_insurance: (ai.has_life_insurance as boolean) ?? null,
    life_insurance_value: (fd.life_insurance_value as string) || (ai.life_insurance_value as string) || null,
    has_business: (ai.has_business as boolean) ?? null,
    business_description: (fd.business_description as string) || (ai.business_description as string) || null,
    has_investments: (ai.has_investments as boolean) ?? null,
    trustee_primary: (ai.trustee_primary as string) || null,
    trustee_alternate: (ai.trustee_alternate as string) || null,
    executor_primary: (ai.executor_primary as string) || null,
    executor_alternate: (ai.executor_alternate as string) || null,
    poa_primary: (ai.poa_primary as string) || null,
    poa_alternate: (ai.poa_alternate as string) || null,
    hcp_primary: (ai.hcp_primary as string) || null,
    hcp_alternate: (ai.hcp_alternate as string) || null,
    guardian_primary: (ai.guardian_primary as string) || null,
    guardian_alternate: (ai.guardian_alternate as string) || null,
    goals_extended: (ext.goals as IntakeSnapshot['goals_extended']) ?? null,
    real_estate_extended: (ext.realEstate as IntakeSnapshot['real_estate_extended']) ?? null,
    financial_accounts: (ext.financialAccounts as IntakeSnapshot['financial_accounts']) ?? null,
    beneficiaries: (ext.beneficiaries as IntakeSnapshot['beneficiaries']) ?? null,
  }
}
