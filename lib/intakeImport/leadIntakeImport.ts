import Anthropic from '@anthropic-ai/sdk'
import { callAnthropic } from '@/lib/anthropic'
import { resolveFirmModel } from '@/lib/firmModels'
import { emptyAdminIntakeFormData, type AdminIntakeFormData } from '@/types/adminIntake'
import { formatPhoneForStorage } from '@/lib/phone'
import type { Lead } from '@/types/leads'
import { linkIntakeToMatter } from '@/lib/intake/linkIntakeToMatter'
import { MATTER_INTAKE_LINK_COLUMNS } from '@/lib/matters/matterIntakeLink'

export const MIN_IMPORT_TEXT_LENGTH = 20
export const MAX_IMPORT_TEXT_LENGTH = 60_000
export const MAX_DOCX_IMPORT_BYTES = 10 * 1024 * 1024
export const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export const LEAD_INTAKE_IMPORT_SYSTEM_PROMPT = `You extract structured Massachusetts estate planning intake data from unstructured text the attorney provides (emails, Lawmatics exports, prior questionnaires, meeting notes, or Word documents).

Output ONLY a single JSON object that matches the schema below. Use empty strings for unknown text fields, false for unknown booleans, [] for unknown arrays. Never invent data - if a field is not stated, leave it empty/false. Dates must be ISO YYYY-MM-DD. Phones can be any format. State defaults to "MA" only if the text clearly indicates a Massachusetts client.

Schema:
{
  "first_name": string, "middle_name": string, "last_name": string, "suffix": string,
  "date_of_birth": string, "is_us_citizen": boolean,
  "phone": string, "email": string,
  "address_line1": string, "address_line2": string, "city": string, "state": string, "zip": string, "county": string,
  "marital_status": "" | "single" | "married" | "divorced" | "widowed",
  "has_children": boolean, "has_minor_children": boolean,
  "children": [ { "first_name": string, "last_name": string, "date_of_birth": string } ],
  "family_notes": string,
  "spouse_first_name": string, "spouse_last_name": string, "spouse_date_of_birth": string,
  "spouse_phone": string, "spouse_email": string, "date_of_marriage": string,
  "estate_value": string, "has_real_property": boolean, "real_property_address": string, "real_property_value": string,
  "has_retirement": boolean, "retirement_value": string,
  "has_life_insurance": boolean, "life_insurance_value": string,
  "has_business": boolean, "business_description": string, "has_investments": boolean,
  "planning_objectives": string, "has_existing_plan": boolean,
  "has_will": boolean, "has_trust": boolean, "has_poa": boolean, "has_hcp": boolean,
  "special_circumstances": string[],
  "trustee_primary": string, "trustee_alternate": string,
  "executor_primary": string, "executor_alternate": string,
  "poa_primary": string, "poa_alternate": string,
  "hcp_primary": string, "hcp_alternate": string,
  "guardian_primary": string, "guardian_alternate": string,
  "special_notes": string
}`

export function getImportTextValidationError(text: string): string | null {
  if (!text.trim()) return 'text required'
  if (text.trim().length < MIN_IMPORT_TEXT_LENGTH) return 'text too short (20 char min)'
  if (text.length > MAX_IMPORT_TEXT_LENGTH) return 'text too long (60k char max)'
  return null
}

export function getDocxFileValidationError(file: File | null): string | null {
  if (!file) return 'No file provided'
  const isDocx = file.name.toLowerCase().endsWith('.docx') || file.type === DOCX_MIME_TYPE
  if (!isDocx) return 'Only Word .docx documents are supported'
  if (file.size > MAX_DOCX_IMPORT_BYTES) return 'Word document is too large (10 MB max)'
  return null
}

export function coerceLeadIntakeImport(parsed: unknown): AdminIntakeFormData {
  const empty = emptyAdminIntakeFormData()
  if (!parsed || typeof parsed !== 'object') return empty
  const p = parsed as Record<string, unknown>
  const out: Record<string, unknown> = { ...empty }

  for (const key of Object.keys(empty) as (keyof AdminIntakeFormData)[]) {
    if (!(key in p)) continue
    const v = p[key]
    const def = empty[key]

    if (Array.isArray(def)) {
      if (key === 'children' && Array.isArray(v)) {
        out[key] = v
          .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object' && !Array.isArray(c))
          .map(c => ({
            id: Math.random().toString(36).slice(2),
            first_name: typeof c.first_name === 'string' ? c.first_name : '',
            last_name: typeof c.last_name === 'string' ? c.last_name : '',
            date_of_birth: typeof c.date_of_birth === 'string' ? c.date_of_birth : '',
          }))
      } else if (Array.isArray(v)) {
        out[key] = v.filter(x => typeof x === 'string')
      }
    } else if (typeof def === 'boolean') {
      out[key] = typeof v === 'boolean' ? v : v === 'true'
    } else if (typeof def === 'string') {
      out[key] = typeof v === 'string' ? v : ''
    }
  }

  return out as unknown as AdminIntakeFormData
}

export async function extractDocxText(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer())
  const mammoth = await import('mammoth')
  const result = await mammoth.extractRawText({ buffer })
  return result.value
}

function parseJsonFromModelText(raw: string): unknown {
  const jsonStart = raw.indexOf('{')
  const jsonEnd = raw.lastIndexOf('}')
  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error('AI did not return JSON')
  }
  return JSON.parse(raw.slice(jsonStart, jsonEnd + 1))
}

interface IntakeImportFallbacks {
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  phone?: string | null
}

function applyImportFallbacks(
  formData: AdminIntakeFormData,
  fallbacks?: IntakeImportFallbacks,
): AdminIntakeFormData {
  if (!formData.first_name && fallbacks?.firstName) formData.first_name = fallbacks.firstName
  if (!formData.last_name && fallbacks?.lastName) formData.last_name = fallbacks.lastName
  if (!formData.email && fallbacks?.email) formData.email = fallbacks.email
  if (!formData.phone && fallbacks?.phone) formData.phone = fallbacks.phone
  return formData
}

export async function parseLeadIntakeText(args: {
  text: string
  context?: string
  fallbacks?: IntakeImportFallbacks
}): Promise<AdminIntakeFormData> {
  const validationError = getImportTextValidationError(args.text)
  if (validationError) throw new Error(validationError)

  const context = args.context?.trim() ||
    'No lead or matter exists yet. Extract the prospective client identity and intake facts from the imported text only.'

  const message = await callAnthropic({
    model: await resolveFirmModel('light'),
    max_tokens: 4000,
    system: LEAD_INTAKE_IMPORT_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `${context}\n\nExtract the intake JSON from the text below.\n\n---BEGIN TEXT---\n${args.text}\n---END TEXT---`,
    }],
  }, { route: 'admin/intake-import', contextType: 'matter' })

  const raw = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim()

  let parsed: unknown
  try {
    parsed = parseJsonFromModelText(raw)
  } catch (e) {
    throw new Error(e instanceof SyntaxError ? 'AI returned invalid JSON' : (e as Error).message)
  }

  return applyImportFallbacks(coerceLeadIntakeImport(parsed), args.fallbacks)
}

function trimOrNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function parseImportedEstateValue(value: string): number | null {
  const raw = value.trim()
  if (!raw) return null

  const ranges: Record<string, number> = {
    under_500k: 400_000,
    '500k_to_1m': 750_000,
    '1m_to_2m': 1_500_000,
    '2m_to_5m': 3_500_000,
    over_5m: 6_000_000,
  }
  if (raw in ranges) return ranges[raw]

  const normalized = raw.toLowerCase().replace(/[$,\s]/g, '')
  const match = normalized.match(/(\d+(?:\.\d+)?)(m|million|k|thousand)?/)
  if (!match) return null
  const amount = Number(match[1])
  if (!Number.isFinite(amount) || amount <= 0) return null

  const suffix = match[2] ?? ''
  if (suffix === 'm' || suffix === 'million') return Math.round(amount * 1_000_000)
  if (suffix === 'k' || suffix === 'thousand') return Math.round(amount * 1_000)
  return Math.round(amount)
}

function joinImportNotes(lines: Array<[string, string | string[] | null | undefined]>): string | null {
  const out: string[] = []
  for (const [label, value] of lines) {
    if (Array.isArray(value)) {
      if (value.length > 0) out.push(`${label}: ${value.join('; ')}`)
      continue
    }
    const trimmed = value?.trim()
    if (trimmed) out.push(`${label}: ${trimmed}`)
  }
  return out.length ? out.join('\n') : null
}

export function buildLeadCreateFieldsFromIntake(data: AdminIntakeFormData): Record<string, unknown> {
  const qualificationNotes = joinImportNotes([
    ['Planning objectives', data.planning_objectives],
    ['Family notes', data.family_notes],
    ['Special circumstances', data.special_circumstances],
    ['Existing plan', data.has_existing_plan ? 'Yes' : null],
    ['Primary trustee', data.trustee_primary],
    ['Primary executor', data.executor_primary],
    ['Primary POA', data.poa_primary],
    ['Primary health care proxy', data.hcp_primary],
    ['Guardian', data.guardian_primary],
  ])

  const internalNotes = joinImportNotes([
    ['Created from imported intake', 'Yes'],
    ['Import notes', data.special_notes],
  ])

  const row: Record<string, unknown> = {
    first_name: data.first_name.trim(),
    last_name: data.last_name.trim(),
    source_channel: 'manual',
    practice_area_interest: 'Estate Planning',
    urgency: 'normal',
  }

  const optional: Record<string, unknown> = {
    email: trimOrNull(data.email),
    phone: formatPhoneForStorage(data.phone),
    spouse_first_name: trimOrNull(data.spouse_first_name),
    spouse_last_name: trimOrNull(data.spouse_last_name),
    spouse_email: trimOrNull(data.spouse_email),
    spouse_phone: formatPhoneForStorage(data.spouse_phone),
    street: trimOrNull(data.address_line1),
    city: trimOrNull(data.city),
    state: trimOrNull(data.state),
    zip: trimOrNull(data.zip),
    marital_status: trimOrNull(data.marital_status),
    has_minor_children: data.has_minor_children,
    estimated_estate_value: parseImportedEstateValue(data.estate_value),
    qualification_notes: qualificationNotes,
    internal_notes: internalNotes,
  }

  for (const [key, value] of Object.entries(optional)) {
    if (value !== null && value !== undefined && value !== '') row[key] = value
  }

  return row
}

export async function createLeadFromImportedIntake(args: {
  text: string
}): Promise<{ lead: Lead; intakeId: string; data: AdminIntakeFormData }> {
  const data = await parseLeadIntakeText({ text: args.text })
  if (!data.first_name.trim() || !data.last_name.trim()) {
    throw new Error('Imported intake must include a client first and last name before a lead can be created')
  }

  const [{ getAdminClient }, { saveAdminIntakeDraft }, { insertCrmActivity }] = await Promise.all([
    import('@/lib/supabaseAdmin'),
    import('@/app/actions/adminIntake'),
    import('@/lib/queries/leads'),
  ])
  const admin = getAdminClient()
  const { data: created, error: insertError } = await admin
    .from('leads')
    .insert(buildLeadCreateFieldsFromIntake(data))
    .select('*')
    .single()

  if (insertError) throw new Error(insertError.message)

  await insertCrmActivity({
    lead_id: created.id,
    type: 'created',
    payload: { source: 'intake_import' },
    actor_user_id: null,
  })

  const { id: intakeId } = await saveAdminIntakeDraft({
    leadId: created.id,
    matterId: null,
    clientIntakeId: null,
    clientUserId: null,
    data,
  })

  const { data: refreshed } = await admin
    .from('leads')
    .select('*')
    .eq('id', created.id)
    .maybeSingle()

  return {
    lead: ((refreshed ?? created) as Lead),
    intakeId,
    data,
  }
}

export async function parseAndSaveLeadIntakeDraft(args: {
  leadId: string
  text: string
}): Promise<{ intakeId: string; data: AdminIntakeFormData }> {
  return parseAndSaveIntakeDraft({ leadId: args.leadId, text: args.text })
}

export async function parseAndSaveMatterIntakeDraft(args: {
  matterId: string
  text: string
}): Promise<{ intakeId: string; data: AdminIntakeFormData }> {
  return parseAndSaveIntakeDraft({ matterId: args.matterId, text: args.text })
}

async function parseAndSaveIntakeDraft(args: {
  leadId?: string
  matterId?: string
  text: string
}): Promise<{ intakeId: string; data: AdminIntakeFormData }> {
  const validationError = getImportTextValidationError(args.text)
  if (validationError) throw new Error(validationError)

  const [{ getAdminClient }, { saveAdminIntakeDraft }] = await Promise.all([
    import('@/lib/supabaseAdmin'),
    import('@/app/actions/adminIntake'),
  ])
  const admin = getAdminClient()
  let leadId = args.leadId ?? null
  const matterId = args.matterId ?? null
  let clientIntakeId: string | null = null
  let clientUserId: string | null = null
  let context = ''
  let fallbackFirstName: string | null = null
  let fallbackLastName: string | null = null
  let fallbackEmail: string | null = null
  let fallbackPhone: string | null = null

  if (leadId) {
    const { data: lead, error: leadErr } = await admin
      .from('client_intake')
      .select('id, first_name, last_name, email, phone, practice_area, user_id')
      .eq('id', leadId)
      .maybeSingle()
    if (leadErr) throw new Error(leadErr.message)
    if (!lead) throw new Error('Lead not found')

    clientIntakeId = leadId
    clientUserId = (lead.user_id as string | null | undefined) ?? null
    fallbackFirstName = lead.first_name ?? null
    fallbackLastName = lead.last_name ?? null
    fallbackEmail = lead.email ?? null
    fallbackPhone = formatPhoneForStorage(lead.phone)
    context = `Lead on file: ${lead.first_name ?? ''} ${lead.last_name ?? ''} <${lead.email ?? ''}> ${fallbackPhone ?? ''} (${lead.practice_area ?? 'Estate Planning'}).`
  } else if (matterId) {
    const [{ data: matter, error: matterErr }, { data: pipeline, error: pipelineErr }] = await Promise.all([
      admin
        .from('matters')
        .select(MATTER_INTAKE_LINK_COLUMNS)
        .eq('id', matterId)
        .maybeSingle(),
      admin
        .from('v_matter_pipeline')
        .select('matter_id, matter_name, client_name, client_email, client_phone, practice_area')
        .eq('matter_id', matterId)
        .maybeSingle(),
    ])
    if (matterErr) throw new Error(matterErr.message)
    if (pipelineErr) throw new Error(pipelineErr.message)
    if (!matter) throw new Error('Matter not found')

    leadId = args.leadId ?? null
    clientIntakeId = (matter.client_intake_id as string | null | undefined) ?? null
    clientUserId = (matter.client_id as string | null | undefined) ?? null
    const nameParts = String(pipeline?.client_name ?? '').trim().split(/\s+/).filter(Boolean)
    fallbackFirstName = nameParts[0] ?? null
    fallbackLastName = nameParts.slice(1).join(' ') || null
    fallbackEmail = (pipeline?.client_email as string | null | undefined) ?? null
    fallbackPhone = formatPhoneForStorage((pipeline?.client_phone as string | null | undefined) ?? null)
    context = `Matter on file: ${pipeline?.matter_name ?? matterId}. Client: ${pipeline?.client_name ?? ''} <${pipeline?.client_email ?? ''}> ${fallbackPhone ?? ''} (${pipeline?.practice_area ?? 'Estate Planning'}).`
  } else {
    throw new Error('Lead or matter is required')
  }

  const formData = await parseLeadIntakeText({
    text: args.text,
    context,
    fallbacks: {
      firstName: fallbackFirstName,
      lastName: fallbackLastName,
      email: fallbackEmail,
      phone: formatPhoneForStorage(fallbackPhone),
    },
  })

  const { id: intakeId } = await saveAdminIntakeDraft({
    leadId,
    matterId,
    clientIntakeId,
    clientUserId,
    data: formData,
  })

  if (matterId) {
    await linkIntakeToMatter(admin, matterId, intakeId)
    const { ensureDesignSheetSeededFromIntake } = await import('@/lib/designSheet/ensureDesignSheetSeeded')
    try {
      await ensureDesignSheetSeededFromIntake(matterId)
    } catch (error) {
      console.error('[intake import] design sheet seed failed:', error)
    }
  }

  return { intakeId, data: formData }
}
