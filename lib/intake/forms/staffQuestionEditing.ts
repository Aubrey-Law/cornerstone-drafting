import 'server-only'
import { getBuilderField, validateSharedField } from '@aubrey-law/estate-fields/core'
import type { getAdminClient } from '@/lib/supabaseAdmin'
import { unpackInitialIntakeData } from '@/lib/intake/unpackInitialData'
import { hydrateIntakeWithContacts } from '@/lib/intakeContactHydration'
import { resolveIntakeDelivery } from './runtime'
import { evaluateCompiledIntakeForm } from './evaluator'
import { mergeStaffHipaaRecipients, STAFF_HIPAA_RECIPIENTS } from './staffHipaaRecipients'
import { mergeStaffFinancialAnswers } from './staffFinancialAnswers'
import { mergeStaffPlanningObjectives } from './staffPlanningObjectives'
import { parseStaffContactOperation } from './staffContactEditing'
import { APPOINTMENT_CHOICE_KEYS, isStaffAppointmentBlock, parseStaffAppointmentEdit, parseStaffAppointmentChoice, mergeExcludedGuardians } from './staffAppointments'
import { formatPhoneForStorage } from '@/lib/phone'
import { isReferralDetailKey } from '@/lib/intakeReferralDetails'
import { isStaffHouseholdBlock, parseStaffHouseholdEdit } from './staffHousehold'
import type { Json } from '@/types/supabase'
import { isStaffContactBlock, isStaffEditableBlock, isStaffEditableQuestion, type StaffQuestionEdit } from './staffEditableFields'

/** Caller must authorize staff before acquiring the service client. */
export async function saveStaffQuestionRow(admin: ReturnType<typeof getAdminClient>, args: StaffQuestionEdit): Promise<void> {
  if (!args || typeof args.intakeId !== 'string' || !args.intakeId || typeof args.expectedVersionId !== 'string'
    || !args.expectedVersionId || !(args.expectedUpdatedAt === null || typeof args.expectedUpdatedAt === 'string')
    || !(isStaffEditableQuestion(args.fieldId) || isStaffEditableBlock(args.fieldId))) throw new Error('This question cannot be edited here.')
  const { data: row, error } = await admin.from('client_intake').select('*').eq('id', args.intakeId).maybeSingle()
  if (error || !row) throw new Error('Unable to load the saved questionnaire.')
  if (row.form_version_id !== args.expectedVersionId || row.updated_at !== args.expectedUpdatedAt) {
    throw new Error('The questionnaire changed. Close and reopen the intake before editing.')
  }
  if (row.status === 'submitted' || row.status === 'approved') throw new Error('This questionnaire has already been submitted.')
  const delivery = await resolveIntakeDelivery(row, 'staff', { INTAKE_RENDERER_MODE: 'legacy' })
  if (delivery.rendererMode !== 'compiled') throw new Error('The pinned questionnaire is unavailable.')
  const hydrated = await hydrateIntakeWithContacts(admin, row, args.intakeId)
  const active = evaluateCompiledIntakeForm(delivery.compiledForm, unpackInitialIntakeData(hydrated)).activeSections
    .flatMap(section => section.items).some(({ item }) => item.kind === 'field' ? item.fieldId === args.fieldId : item.kind === 'block' && isStaffEditableBlock(item.blockId) && item.blockId === args.fieldId)
  if (!active) throw new Error('This question is not active in the saved questionnaire.')
  if (isStaffHouseholdBlock(args.fieldId)) {
    const edit = parseStaffHouseholdEdit(args.value)
    const rpc = admin.rpc.bind(admin) as unknown as (name: string, args: Record<string, Json | undefined>) => Promise<{ error: { message: string } | null }>
    const { error: householdError } = await rpc('edit_pinned_intake_household', {
      p_intake_id: args.intakeId, p_version_id: args.expectedVersionId, p_updated_at: args.expectedUpdatedAt,
      p_kind: args.fieldId === 'children' ? 'child' : 'spouse', p_operation: edit.operation,
      p_contact_id: edit.contactId, p_expected: edit.expected, p_patch: edit.patch,
    })
    if (householdError) throw new Error(householdError.message)
    return
  }
  const isExcludedGuardians = args.fieldId === 'guardian' && !!args.value && typeof args.value === 'object' && 'excludedNames' in args.value
  const isAppointmentChoice = isStaffAppointmentBlock(args.fieldId) && !!args.value && typeof args.value === 'object' && ('reviewChoice' in args.value || isExcludedGuardians)
  if (isStaffAppointmentBlock(args.fieldId) && !isAppointmentChoice) {
    const edit = parseStaffAppointmentEdit(args.fieldId, args.value)
    const rpc = admin.rpc.bind(admin) as unknown as (name: string, args: Record<string, Json | undefined>) => Promise<{ error: { message: string } | null }>
    const { error: appointmentError } = await rpc('edit_pinned_intake_appointment', {
      p_intake_id: args.intakeId, p_version_id: args.expectedVersionId, p_updated_at: args.expectedUpdatedAt,
      p_matter_id: edit.matterId, p_role: edit.role, p_party: edit.party, p_priority: edit.priority,
      p_coagent: edit.coagent, p_contact_id: edit.contactId, p_expected: edit.expected,
    })
    if (appointmentError) throw new Error(appointmentError.message)
    return
  }
  if (isStaffContactBlock(args.fieldId)) {
    const edit = parseStaffContactOperation(args.value)
    const rpc = admin.rpc.bind(admin) as unknown as (name: string, args: Record<string, Json | undefined>) => Promise<{ error: { message: string } | null }>
    const { error: contactError } = await rpc(edit.operation === 'restore' ? 'restore_pinned_intake_contact' : edit.operation === 'edit' ? 'edit_pinned_intake_contact' : 'change_pinned_intake_contact_membership', {
      ...(edit.operation === 'edit' || edit.operation === 'restore' ? {} : { p_operation: edit.operation }),
      p_intake_id: args.intakeId, p_version_id: args.expectedVersionId, p_updated_at: args.expectedUpdatedAt,
      p_contact_id: edit.contactId, p_expected: edit.expected as Json, ...(edit.operation === 'restore' ? {} : { p_patch: edit.patch as Json }),
    })
    if (contactError) throw new Error(contactError.message)
    return
  }
  let patch: Record<string, unknown>
  if (isExcludedGuardians) patch = mergeExcludedGuardians(args.value, row.fiduciary_entries)
  else if (isStaffAppointmentBlock(args.fieldId)) patch = { review_choices: { ...plainDetails(row.review_choices), [APPOINTMENT_CHOICE_KEYS[args.fieldId]]: parseStaffAppointmentChoice(args.value) } }
  else if (args.fieldId === 'address' || args.fieldId === 'existing_document_uploads') {
    if (!args.value || typeof args.value !== 'object' || Array.isArray(args.value)) throw new Error('Enter valid question answers.')
    patch = {}
    const keys: Record<string, string> = args.fieldId === 'address' ? { street_address: 'street', city: 'city', state: 'state', zip: 'zip', county: 'county' }
      : { has_existing_plan: 'has_existing_plan', has_divorce_settlement: 'has_divorce_settlement', has_ltc_insurance: 'has_ltc_insurance', has_prior_gift_tax: 'has_prior_gift_tax' }
    for (const [key, value] of Object.entries(args.value)) {
      if (!keys[key]) throw new Error('Invalid grouped answer field.')
      Object.assign(patch, scalarPatch(keys[key], value, row))
    }
  }
  else if (args.fieldId === 'financial_assets') patch = { financial_details: mergeStaffFinancialAnswers(args.value, row.financial_details) }
  else if (args.fieldId === 'planning_objectives') patch = { planning_objectives: mergeStaffPlanningObjectives(args.value, row.planning_objectives) }
  else if (args.fieldId === STAFF_HIPAA_RECIPIENTS || args.fieldId.startsWith('college_')) {
    const details = row.college_prep_details
    if (details != null && (typeof details !== 'object' || Array.isArray(details))) throw new Error('The saved college answers need review before editing.')
    const normalized = args.fieldId === STAFF_HIPAA_RECIPIENTS
      ? mergeStaffHipaaRecipients(args.value, details?.hipaa_recipients)
      : validatedScalar(args.fieldId, args.value)
    patch = { college_prep_details: { ...(details ?? {}), [args.fieldId.slice('college_'.length)]: normalized } }
  }
  else patch = scalarPatch(args.fieldId, args.value, row)
  let update = admin.from('client_intake').update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', args.intakeId).eq('form_version_id', args.expectedVersionId)
  update = row.updated_at === null ? update.is('updated_at', null) : update.eq('updated_at', row.updated_at)
  update = row.status === null ? update.is('status', null) : update.eq('status', row.status)
  const { data: saved, error: saveError } = await update.select('id').maybeSingle()
  if (saveError || !saved) throw new Error('The questionnaire changed. Close and reopen the intake before editing.')
}

function plainDetails(raw: unknown): Record<string, unknown> {
  if (raw == null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('The saved answers need review before editing.')
  return raw as Record<string, unknown>
}

function scalarPatch(fieldId: string, value: unknown, row: Record<string, unknown>) {
  const normalized = validatedScalar(fieldId, value)
  const patch: Record<string, unknown> = {}
  getBuilderField(fieldId).write(normalized, (key, answer) => {
    if (key === 'asset_types') patch.financial_details = { ...plainDetails(row.financial_details), asset_types: answer }
    else if (key === 'referral_source' || isReferralDetailKey(key)) {
      const family = plainDetails(row.family_details)
      patch.family_details = { ...family, referral: { ...plainDetails(family.referral), [key === 'referral_source' ? 'source' : key]: answer } }
      if (key === 'referral_source') patch.referral_source = answer
    }
    else patch[key === 'street_address' ? 'address_line1' : key === 'prior_name' ? 'prior_names' : key] = key === 'phone' ? formatPhoneForStorage(String(answer ?? '')) : answer
  })
  if (['client_first_name', 'client_middle_name', 'client_last_name'].includes(fieldId)) {
    patch.full_name = ['first_name', 'middle_name', 'last_name'].map(key => Object.hasOwn(patch, key) ? patch[key] : row[key]).filter(Boolean).join(' ') || null
  }
  return patch
}

function validatedScalar(fieldId: string, value: unknown): unknown {
  if (!isStaffEditableQuestion(fieldId)) throw new Error('This question cannot be edited here.')
  const field = getBuilderField(fieldId)
  const validShape = field.control === 'boolean' ? value === null || typeof value === 'boolean'
    : field.control === 'multiselect' ? Array.isArray(value) && value.length <= 100 && value.every(v => typeof v === 'string' && v.length <= 200)
      : typeof value === 'string' && value.length <= 20000
  if (!validShape) throw new Error('Enter a valid answer.')
  const empty = value === null || value === '' || (Array.isArray(value) && !value.length)
  if (!empty) {
    if (field.options?.length) {
      const choices = new Set(field.options.map(option => option.value))
      if (!(Array.isArray(value) ? value : [value]).every(v => choices.has(String(v)))) throw new Error('Choose an available answer.')
    }
    const validationError = validateSharedField(fieldId, value)
    if (validationError) throw new Error(validationError)
    if (field.control === 'date' && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
      || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw new Error('Enter a valid date.')
  }
  // Some shared display fields still carry text normalizers; lists retain their shape.
  return field.control === 'multiselect' ? value : field.normalize ? field.normalize(value) : value
}
