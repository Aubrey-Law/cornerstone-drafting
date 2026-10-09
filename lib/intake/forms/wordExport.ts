import { getBuilderField, readBuilderFieldValue, INTAKE_ASSET_TYPE_OPTIONS, INTAKE_ASSET_TOTALS_KEYS, SPECIAL_CIRCUMSTANCE_OPTIONS } from '@aubrey-law/estate-fields/core'
import { CITIZENSHIP_STATUS_OPTIONS, normalizeCitizenshipStatus } from '@/lib/sharedFields'
import { DESIGN_DOCUMENT_LABELS, type DesignDocumentKey } from '@/lib/designSheetDocumentInclusions'
import { INTAKE_PLAN_TYPE_OPTIONS, normalizeIntakePlanType } from '@/lib/intakePlanType'
import { fiduciaryReviewTitle } from '@/lib/sharedFields/reviewDisplay'
import { formatReviewDateValue } from '@/lib/intake/portalReviewSections'
import { unpackInitialIntakeData } from '@/lib/intake/unpackInitialData'
import { EMPTY_VALUE, type IntakeExportSection } from '@/lib/intake/wordExport'
import { getIntakeAttorneyDocumentInclusions } from './blockRegistry'
import { evaluateCompiledIntakeForm } from './evaluator'
import type { CompiledIntakeForm, CompiledIntakeItem } from './compiler'
import type { IntakeBlockId } from './types'

type Data = Record<string, unknown>
type BlockItem = Extract<CompiledIntakeItem, { kind: 'block' }>
type Labels = readonly (readonly [string, string])[]
const record = (value: unknown): Data => value && typeof value === 'object' && !Array.isArray(value) ? value as Data : {}
const records = (value: unknown): Data[] => Array.isArray(value) ? value.map(record) : []
function valueText(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'string') return value.trim() || EMPTY_VALUE
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(valueText).join(', ') || EMPTY_VALUE
  return EMPTY_VALUE
}
function fields(data: Data, labels: Labels, title = ''): IntakeExportSection {
  return { title, rows: labels.map(([key, label]) => ({ label, value: key.includes('date') || key === 'dob' ? formatReviewDateValue(valueText(data[key])) : valueText(data[key]) })) }
}
const NAME: Labels = [['first_name', 'First name'], ['middle_name', 'Middle name'], ['last_name', 'Last name'], ['suffix', 'Suffix']]
const CONTACT: Labels = [...NAME, ['relationship', 'Relationship'], ['preferred_pronoun', 'Pronouns'], ['phone', 'Phone'], ['email', 'Email'], ['street', 'Street'], ['city', 'City'], ['state', 'State'], ['zip', 'ZIP'], ['address', 'Address']]
function entries(data: unknown, labels: Labels, title: string): IntakeExportSection {
  const items = records(data)
  return { title, rows: [], ...(items.length ? { parts: items.map((entry, i) => fields(entry, labels, `${title} ${i + 1}`)) } : { lines: [EMPTY_VALUE] }) }
}
function roles(data: Data, keys: string[], choiceKey: string): IntakeExportSection[] {
  const choice = record(data._review_choices)[choiceKey]
  return [
    ...(choice ? [{ title: '', rows: [{ label: 'If information is blank', value: choice === 'discuss_with_attorney' ? 'Discuss with attorney' : choice === 'not_provided_yet' ? 'Not provided yet' : valueText(choice) }] }] : []),
    ...keys.map(key => entries(data[`_${key}`], [...CONTACT, ['priority', 'Priority'], ['is_coagent', 'Co-agent']], fiduciaryReviewTitle(`_${key}`))),
  ]
}

function financial(data: Data): IntakeExportSection[] {
  const selected = Array.isArray(data.asset_types) ? data.asset_types : []
  const parts: IntakeExportSection[] = [{ title: '', rows: [{ label: 'What types of assets do you own?', value: selected.map(v => INTAKE_ASSET_TYPE_OPTIONS.find(o => o.value === v)?.label ?? valueText(v)).join(', ') || EMPTY_VALUE }] }]
  for (const option of INTAKE_ASSET_TYPE_OPTIONS) {
    if (!selected.includes(option.value)) continue
    const detail = data[`financial_${option.value}`]
    if ((INTAKE_ASSET_TOTALS_KEYS as readonly string[]).includes(option.value)) {
      parts.push(fields(record(detail), [['client_total', 'Client'], ['spouse_total', 'Spouse'], ['joint_total', 'Joint']], option.label))
    } else if (option.value === 'real_estate') {
      parts.push(entries(detail, [['type', 'Type'], ['address', 'Address'], ['owner', 'Owner'], ['value', 'Value'], ['mortgage', 'Mortgage'], ['notes', 'Notes']], option.label))
    } else if (option.value === 'business_interests') {
      parts.push(entries(detail, [['name', 'Name'], ['business_type', 'Business type'], ['interest_pct', 'Ownership percentage'], ['value', 'Value'], ['owner', 'Owner']], option.label))
    } else if (option.value === 'liabilities') {
      parts.push(entries(detail, [['description', 'Description'], ['value', 'Amount'], ['owner', 'Owner']], option.label))
    } else parts.push({ title: option.label, rows: [], lines: [valueText(detail)] })
  }
  const details = record(data.financial_circumstance_details)
  parts.push({ title: 'Special circumstances', rows: SPECIAL_CIRCUMSTANCE_OPTIONS.flatMap(({ value, label }) => [
    { label, value: valueText(data[value]) },
    ...(data[value] === true ? [{ label: `${label} — details`, value: valueText(details[value]) }] : []),
  ]) })
  return parts
}

// Explicit projections are intentional: exporting arbitrary stored JSON could
// disclose workflow metadata or answers to questions absent from this version.
const BLOCK_EXPORTERS = {
  address: (data, item) => [fields(data, [['street_address', 'Street address'], ['city', 'City'], ['state', 'State'], ['zip', 'ZIP'], ...(item.config.includeCounty === false ? [] : [['county', 'County']] as Labels)])],
  spouse_details: data => {
    const spouse = record(data._spouse)
    const citizenship = normalizeCitizenshipStatus(spouse.citizenship_status, typeof spouse.is_us_citizen === 'boolean' ? spouse.is_us_citizen : null)
    return [fields({ ...spouse, prior_name: spouse.prior_name ?? spouse.prior_names, citizenship_status: CITIZENSHIP_STATUS_OPTIONS.find(o => o.value === citizenship)?.label }, [...NAME, ['prior_name', 'Prior name'], ['preferred_name', 'Preferred name'], ['date_of_birth', 'Date of birth'], ['preferred_pronoun', 'Pronouns'], ['citizenship_status', 'Citizenship / immigration status'], ['email', 'Email'], ['phone', 'Phone']]), fields(data, [['date_of_marriage', 'Date of marriage']])]
  },
  children: data => [entries(data._children, [...NAME, ['date_of_birth', 'Date of birth'], ['pronouns', 'Pronouns'], ['email', 'Email'], ['phone', 'Phone'], ['same_address', 'Same address'], ['parent', 'Parent'], ['relationship', 'Relationship']], 'Children')],
  financial_assets: financial,
  planning_objectives: data => [fields(record(data.planning_objectives), [['why_choose_firm', 'Why did you choose Aubrey Law?'], ['why_now', 'Why are you planning now?'], ['make_things_easy', 'Is making things easy for loved ones important to you?']])],
  existing_document_uploads: data => [{ ...fields(data, [['has_existing_plan', 'Do you have a will, trust, or other estate planning document?'], ['has_divorce_settlement', 'Are you making payments pursuant to a divorce or property settlement order?'], ['has_ltc_insurance', 'Do you own a long-term care insurance policy?'], ['has_prior_gift_tax', 'Have you ever filed federal or state gift tax returns?']]), lines: ['Uploaded files are available separately in the questionnaire; file contents are not included in this copy.'] }],
  additional_contacts: data => [entries(data._additional_contacts, CONTACT, 'Additional contacts')],
  client_fiduciaries: data => roles(data, ['fid_trustee_client', 'fid_personal_rep_client', 'fid_poa_client', 'fid_hcp_client'], 'fiduciaries'),
  spouse_fiduciaries: data => roles(data, ['fid_personal_rep_spouse', 'fid_poa_spouse', 'fid_hcp_spouse'], 'spouse_fiduciaries'),
  guardian: data => roles(data, ['fid_guardian_client', 'fid_excluded_guardian'], 'guardian'),
  college_parents: data => [entries(data._additional_contacts, CONTACT, 'Parents & guardians')],
  college_agents: data => roles(data, ['fid_poa_client', 'fid_hcp_client'], 'cp_agents'),
  college_hipaa_recipients: data => [entries(data.college_hipaa_recipients, [['name', 'Name'], ['relationship', 'Relationship'], ['phone', 'Phone'], ['email', 'Email']], 'HIPAA recipients')],
  review_submit: () => [],
  attorney_plan_structure: data => [{ title: '', rows: [{ label: 'Plan structure', value: INTAKE_PLAN_TYPE_OPTIONS.find(o => o.value === normalizeIntakePlanType(data.plan_type))?.title ?? EMPTY_VALUE }] }],
  attorney_documents: data => {
    const inclusions = getIntakeAttorneyDocumentInclusions(data)
    const keys: DesignDocumentKey[] = ['trust', 'will', 'deed', 'young_adult_estate_plan', 'dpoa', 'healthcare']
    return [{ title: 'Documents', rows: keys.map(key => ({ label: DESIGN_DOCUMENT_LABELS[key], value: valueText(inclusions[key]) })) }]
  },
} satisfies Record<IntakeBlockId, (data: Data, item: BlockItem) => IntakeExportSection[]>

/** Export only evaluated questions from the exact authorized compiled version. */
export function buildCompiledIntakeExportSections(form: CompiledIntakeForm, savedData: Data): IntakeExportSection[] {
  const data = unpackInitialIntakeData(savedData)
  // Contact hydration is authoritative over older embedded contact snapshots.
  for (const [key, value] of Object.entries(savedData)) if (key.startsWith('_')) data[key] = value
  return evaluateCompiledIntakeForm(form, data).activeSections.flatMap(section => {
    const parts: IntakeExportSection[] = []
    for (const { item } of section.items) {
      if (item.kind === 'field') {
        const field = getBuilderField(item.fieldId)
        const raw = readBuilderFieldValue(item.fieldId, data)
        const format = (value: unknown) => field.options?.find(o => o.value === value)?.label ?? valueText(value)
        let value = Array.isArray(raw) ? raw.map(format).join(', ') || EMPTY_VALUE : format(raw)
        if (field.control === 'date') value = formatReviewDateValue(value)
        const last = parts.at(-1)
        if (last && !last.title && !last.parts && !last.lines) last.rows.push({ label: item.label, value })
        else parts.push({ title: '', rows: [{ label: item.label, value }] })
      } else if (item.kind === 'block' && item.blockId !== 'review_submit') {
        parts.push({ title: item.title ?? '', rows: [], parts: BLOCK_EXPORTERS[item.blockId](data, item) })
      }
    }
    return parts.length ? [{ title: section.title, rows: [], parts }] : []
  })
}
