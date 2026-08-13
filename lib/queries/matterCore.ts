import { getAdminClient } from '@/lib/supabaseAdmin'
import { inflateDesignSheetRow } from '@/lib/designSheetPersistence'
import { formatPhoneDisplay } from '@/lib/phone'
import { loadSpouseContact } from '@/lib/contacts/loadSpouseContact'
import { loadHouseholdChildren } from '@/lib/contacts/loadHouseholdChildren'
import { loadIntakeFiduciarySnapshot } from '@/lib/contacts/intakeFiduciarySnapshot'
import type { PipelineMatter, DesignSheet, MatterContact, DesignSheetChild, FiduciarySlot } from '@/types/database'

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

export const PIPELINE_MATTER_COLUMNS =
  'matter_id, matter_name, stage, status, flags, matter_created, client_name, client_email, client_phone, client_dob, client_address, spouse_name, spouse_email, spouse_phone, spouse_dob, spouse_address, plan_type, marital_status, has_minor_children, taxable_estate, intake_status, intake_sent_at, design_status, intake_submitted_at, drafts_sent_at, signing_date, documents_executed_at, next_appointment, next_appointment_type, practice_area, referral_source, fee_amount, opened_at, client_status' as const

/**
 * The consolidated view's columns. Kept separate from PIPELINE_MATTER_COLUMNS
 * because `v_matter_pipeline` does not have these two — selecting them from it
 * would error for every one of its other callers.
 */
export const PIPELINE_MATTER_ALL_COLUMNS =
  `${PIPELINE_MATTER_COLUMNS}, relationship_status, matter_number` as const

function addressFromIntake(row: Record<string, unknown> | null | undefined): string | null {
  if (!row) return null
  const street = [row.address_line1, row.address_line2].filter(Boolean).join(' ').trim()
  const locality = [row.city, [row.state, row.zip].filter(Boolean).join(' ').trim()].filter(Boolean).join(', ').trim()
  const address = [street, locality].filter(Boolean).join(', ').trim()
  return address || null
}

async function fetchMatterFallback(
  id: string,
  includeLeads: boolean,
): Promise<PipelineMatter | null> {
  const supabase = getAdminClient()
  const { data: matter, error: matterError } = await supabase
    .from('matters')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (matterError) {
    console.error('fetchMatter fallback matter error:', matterError)
    return null
  }
  if (!matter) return null
  if (!includeLeads && matter.relationship_status !== 'hired') return null

  const intakeId = (matter.client_intake_id ?? null) as string | null
  const [{ data: intake, error: intakeError }, { data: spouse, error: spouseError }, { data: designSheet }, { data: details }] = await Promise.all([
    intakeId ? supabase.from('client_intake').select('*').eq('id', intakeId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    intakeId
      ? supabase.from('contacts').select('*').eq('client_intake_id', intakeId).eq('relationship_type', 'spouse').limit(1).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase.from('design_sheets').select('status').eq('matter_id', id).order('version', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('matter_details').select('*').eq('client_id', id).maybeSingle(),
  ])

  if (intakeError) console.error('fetchMatter fallback intake error:', intakeError)
  if (spouseError) console.error('fetchMatter fallback spouse error:', spouseError)

  const clientName = [intake?.first_name, intake?.last_name].filter(Boolean).join(' ').trim()
  const spouseName = [spouse?.first_name, spouse?.last_name].filter(Boolean).join(' ').trim()
  const fallback: PipelineMatter = {
    matter_id: matter.id,
    matter_name: matter.name || clientName || 'Untitled matter',
    stage: matter.stage,
    status: matter.status,
    flags: matter.flags ?? null,
    matter_created: matter.created_at,
    client_name: clientName || intake?.full_name || matter.name || 'Unknown client',
    client_email: intake?.email ?? '',
    client_phone: formatPhoneDisplay(intake?.phone ?? ''),
    client_dob: intake?.date_of_birth ?? null,
    client_address: addressFromIntake(intake),
    spouse_name: spouseName || null,
    spouse_email: spouse?.email ?? null,
    spouse_phone: formatPhoneDisplay(spouse?.phone ?? null),
    spouse_dob: spouse?.date_of_birth ?? null,
    spouse_address: addressFromIntake(spouse),
    plan_type: intake?.plan_type ?? details?.plan_type ?? null,
    marital_status: intake?.marital_status ?? null,
    has_minor_children: intake?.has_minor_children ?? null,
    taxable_estate: intake?.taxable_estate ?? null,
    intake_status: intake?.status ?? null,
    intake_sent_at: intake?.intake_sent_at ?? null,
    design_status: designSheet?.status ?? null,
    intake_submitted_at: matter.intake_submitted_at ?? null,
    drafts_sent_at: matter.drafts_sent_at ?? null,
    signing_date: matter.signing_date ?? null,
    documents_executed_at: matter.documents_executed_at ?? null,
    next_appointment: null,
    next_appointment_type: null,
    practice_area: details?.practice_area ?? intake?.practice_area ?? null,
    referral_source: details?.referral_source ?? intake?.referral_source ?? null,
    fee_amount: details?.flat_fee_amount ?? null,
    opened_at: details?.open_date ?? null,
    client_status: details?.client_status ?? null,
  }
  return normalizeFlags(fallback)
}

/**
 * Load one matter's pipeline row.
 *
 * `includeLeads` reads the consolidated view instead of the hired-only one, for
 * the surfaces where a lead is just a matter. It is opt-in rather than the
 * default because the drafting pages ask for a matter meaning a signed one, and
 * silently handing them a lead would take them somewhere they cannot work.
 *
 * Both the view and the fallback have to agree: the fallback reads `matters`
 * directly, so without the same flag it would reject the lead the view just
 * declined to return, and the caller would see null either way.
 */
export async function fetchMatter(
  id: string,
  options: { includeLeads?: boolean } = {},
): Promise<PipelineMatter | null> {
  const includeLeads = options.includeLeads === true
  const supabase = getAdminClient()
  const { data, error } = await supabase
    // The consolidated view is a superset, so the same column list works.
    .from(includeLeads ? 'v_matter_pipeline_all' : 'v_matter_pipeline')
    .select(PIPELINE_MATTER_COLUMNS)
    .eq('matter_id', id)
    .single()

  if (error) {
    console.error('fetchMatter error:', error)
    return fetchMatterFallback(id, includeLeads)
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
  const supabase = getAdminClient()
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
    .select('id, first_name, middle_name, last_name, relationship_type, relationship_label, phone, email, address_line1, date_of_birth')
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
    date_of_birth: c.date_of_birth ?? null,
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
  prior_names: string | null
  is_us_citizen: boolean | null
  spouse_first_name: string | null
  spouse_middle_name: string | null
  spouse_last_name: string | null
  spouse_date_of_birth: string | null
  spouse_phone: string | null
  spouse_email: string | null
  spouse_preferred_pronoun: string | null
  spouse_prior_names: string | null
  spouse_is_us_citizen: boolean | null
  date_of_marriage: string | null
  children: DesignSheetChild[] | null
  has_minor_children: boolean | null
  planning_goals: string[] | null
  planning_objectives: string | null
  special_circumstances: string[] | null
  special_notes: string | null
  excluded_guardian: string | null
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
  trustee_slots: FiduciarySlot[] | null
  executor_slots: FiduciarySlot[] | null
  poa_slots: FiduciarySlot[] | null
  hcp_slots: FiduciarySlot[] | null
  guardian_slots: FiduciarySlot[] | null
  spouse_trustee_slots: FiduciarySlot[] | null
  spouse_executor_slots: FiduciarySlot[] | null
  spouse_poa_slots: FiduciarySlot[] | null
  spouse_hcp_slots: FiduciarySlot[] | null
  goals_extended: { primaryGoals: string[]; specialConsiderations: string; wishesAndConcerns: string } | null
  real_estate_extended: Array<{ address: string; ownership: string; estimatedValue: string; hasMortgage: boolean }> | null
  financial_accounts: Array<{ institution: string; accountType: string; approximateValue: string }> | null
  beneficiaries: Array<{ fullName: string; relationship: string; percentage: string }> | null
  /** Attorney plan-structure choice (IntakePlanType vocabulary, e.g. 'joint_rlt'). */
  plan_type: string | null
  /** Attorney document toggles saved on the intake (keys of DesignDocumentInclusions). */
  document_inclusions: Record<string, boolean> | null
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
  let householdChildren: DesignSheetChild[] = []
  let fiduciary = {
    trustee_primary: null as string | null,
    trustee_alternate: null as string | null,
    executor_primary: null as string | null,
    executor_alternate: null as string | null,
    poa_primary: null as string | null,
    poa_alternate: null as string | null,
    hcp_primary: null as string | null,
    hcp_alternate: null as string | null,
    guardian_primary: null as string | null,
    guardian_alternate: null as string | null,
    trustee_slots: null as FiduciarySlot[] | null,
    executor_slots: null as FiduciarySlot[] | null,
    poa_slots: null as FiduciarySlot[] | null,
    hcp_slots: null as FiduciarySlot[] | null,
    guardian_slots: null as FiduciarySlot[] | null,
    spouse_trustee_slots: null as FiduciarySlot[] | null,
    spouse_executor_slots: null as FiduciarySlot[] | null,
    spouse_poa_slots: null as FiduciarySlot[] | null,
    spouse_hcp_slots: null as FiduciarySlot[] | null,
  }
  if (clientIntakeId) {
    const [{ data }, spouseContact, childContacts] = await Promise.all([
      admin.from('client_intake').select('*').eq('id', clientIntakeId).maybeSingle(),
      loadSpouseContact(admin, clientIntakeId),
      loadHouseholdChildren(admin, clientIntakeId),
    ])
    if (data) ai = data as Record<string, unknown>
    spouse = spouseContact
    householdChildren = childContacts
    fiduciary = await loadIntakeFiduciarySnapshot(admin, clientIntakeId, ai)
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

  const planningGoalsRaw = ai.planning_goals
  const planningGoals = Array.isArray(planningGoalsRaw)
    ? planningGoalsRaw.filter((g): g is string => typeof g === 'string')
    : null

  const children = householdChildren.length ? householdChildren : null

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
    prior_names: (ai.prior_names as string) || null,
    is_us_citizen: (ai.is_us_citizen as boolean) ?? null,
    spouse_first_name: spouse?.first_name || null,
    spouse_middle_name: spouse?.middle_name || null,
    spouse_last_name: spouse?.last_name || null,
    spouse_date_of_birth: spouse?.date_of_birth || null,
    spouse_phone: formatPhoneDisplay(spouse?.phone ?? '') || null,
    spouse_email: spouse?.email || null,
    spouse_preferred_pronoun: spouse?.preferred_pronoun || null,
    spouse_prior_names: spouse?.prior_names || null,
    spouse_is_us_citizen: spouse?.is_us_citizen ?? null,
    date_of_marriage: (ai.date_of_marriage as string) || null,
    children,
    has_minor_children: (ai.has_minor_children as boolean) ?? null,
    planning_goals: planningGoals?.length ? planningGoals : null,
    planning_objectives: (ai.planning_objectives as string) || null,
    special_circumstances: (ai.special_circumstances as string[]) || null,
    special_notes: (ai.special_notes as string) || null,
    excluded_guardian: (ai.excluded_guardian as string) || null,
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
    trustee_primary: fiduciary.trustee_primary,
    trustee_alternate: fiduciary.trustee_alternate,
    executor_primary: fiduciary.executor_primary,
    executor_alternate: fiduciary.executor_alternate,
    poa_primary: fiduciary.poa_primary,
    poa_alternate: fiduciary.poa_alternate,
    hcp_primary: fiduciary.hcp_primary,
    hcp_alternate: fiduciary.hcp_alternate,
    guardian_primary: fiduciary.guardian_primary,
    guardian_alternate: fiduciary.guardian_alternate,
    trustee_slots: fiduciary.trustee_slots,
    executor_slots: fiduciary.executor_slots,
    poa_slots: fiduciary.poa_slots,
    hcp_slots: fiduciary.hcp_slots,
    guardian_slots: fiduciary.guardian_slots,
    spouse_trustee_slots: fiduciary.spouse_trustee_slots,
    spouse_executor_slots: fiduciary.spouse_executor_slots,
    spouse_poa_slots: fiduciary.spouse_poa_slots,
    spouse_hcp_slots: fiduciary.spouse_hcp_slots,
    goals_extended: (ext.goals as IntakeSnapshot['goals_extended']) ?? null,
    real_estate_extended: (ext.realEstate as IntakeSnapshot['real_estate_extended']) ?? null,
    financial_accounts: (ext.financialAccounts as IntakeSnapshot['financial_accounts']) ?? null,
    beneficiaries: (ext.beneficiaries as IntakeSnapshot['beneficiaries']) ?? null,
    plan_type: (ai.plan_type as string) || null,
    document_inclusions:
      ai.document_inclusions && typeof ai.document_inclusions === 'object' && !Array.isArray(ai.document_inclusions)
        ? (ai.document_inclusions as Record<string, boolean>)
        : null,
  }
}
