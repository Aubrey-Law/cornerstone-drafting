import type { DraftPayload } from '@/lib/buildDraftPayload'
import { formatPhoneDisplay } from '@/lib/phone'
import { estateValueLabel } from '@aubrey-law/estate-fields'
import { firmTodayKey } from '@/lib/firmDate'
import { loadSystemSkillBody } from '@/lib/works/systemSkills'
import {
  DESIGN_SHEET_DECISION_FIELDS,
  readDecisionFieldRaw,
} from '@/lib/designSheetImport/decisionFields'
import type { DesignSheet } from '@/types/database'

export type Row = Record<string, unknown>

export function text(value: unknown, fallback = '-') {
  if (value === null || value === undefined || value === '') return fallback
  if (Array.isArray(value)) return value.length ? value.map(item => String(item)).join(', ') : fallback
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function asRow(value: unknown): Row | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : null
}

function money(value: unknown) {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return '-'
  return `$${num.toLocaleString()}`
}

export function fullName(row: Row | null | undefined) {
  if (!row) return '-'
  return text(
    row.full_name ??
    [row.first_name, row.middle_name, row.last_name].filter(Boolean).join(' '),
  )
}

export function summarizeAssets(
  intake: Row | null,
  designSheet: Row | null,
  assetIntakeRows: Row[] = [],
) {
  const financialDetails = asRow(intake?.financial_details)
  const detail = (key: string) => intake?.[key] ?? financialDetails?.[key]
  const parts = [
    `Estimated estate value: ${text(intake?.estate_value ?? detail('estimated_estate_value') ?? detail('taxable_estate'))}`,
    `Taxable estate: ${money(detail('taxable_estate'))}`,
    `Real property: ${text(detail('real_property_address'))} ${text(detail('real_property_value'), '')}`.trim(),
    `Retirement: ${text(detail('retirement_value'))}`,
    `Life insurance: ${text(detail('life_insurance_value'))}`,
    `Business: ${text(detail('business_description'))}`,
  ]

  if (assetIntakeRows.length > 0) {
    const total = assetIntakeRows.reduce((sum, row) => sum + (Number(row.value) || 0), 0)
    parts.push(`Recorded assets (${assetIntakeRows.length} items, total ${money(total)}):`)
    for (const row of assetIntakeRows.slice(0, 40)) {
      parts.push(
        `  - ${text(row.category)}: ${text(row.description)} — ${money(row.value)} (${text(row.ownership)})`,
      )
    }
    if (assetIntakeRows.length > 40) {
      parts.push(`  - … and ${assetIntakeRows.length - 40} more asset rows`)
    }
  }

  if (designSheet?.assets) {
    parts.push(`Design-sheet assets: ${text(designSheet.assets)}`)
  }

  return parts.filter(part => !part.endsWith('-') && !part.endsWith(':')).join('\n')
}

export function summarizeFamily(intake: Row | null, matter: Row | null) {
  const children = Array.isArray(intake?.children) ? intake.children : null
  return [
    `Marital status: ${text(intake?.marital_status ?? matter?.marital_status)}`,
    `Spouse: ${text(intake?.spouse_name ?? [intake?.spouse_first_name, intake?.spouse_last_name].filter(Boolean).join(' '))}`,
    `Children count: ${children ? children.length : '-'}`,
    `Children: ${formatChildrenList(children)}`,
    `Minor children: ${text(intake?.has_minor_children ?? matter?.has_minor_children)}`,
  ].join('\n')
}

export function summarizeFiduciaries(intake: Row | null, designSheet: Row | null) {
  return [
    `Trustee: ${text(intake?.trustee_primary ?? designSheet?.trustee_slots)}`,
    `Executor: ${text(intake?.executor_primary ?? designSheet?.executor_slots)}`,
    `POA: ${text(intake?.poa_primary ?? designSheet?.poa_slots)}`,
    `Healthcare proxy: ${text(intake?.hcp_primary ?? designSheet?.hcp_slots)}`,
    `Guardian: ${text(intake?.guardian_primary ?? designSheet?.guardian_slots)}`,
  ].join('\n')
}

export function formatChildrenList(children: unknown): string {
  if (!Array.isArray(children) || children.length === 0) return '-'
  return children.map((child) => {
    const row = asRow(child)
    if (!row) return String(child)
    const name =
      text(row.name ?? [row.first_name, row.middle_name, row.last_name].filter(Boolean).join(' '))
    const dob = row.dob ?? row.date_of_birth
    const minor = row.is_minor === true ? 'minor' : row.is_minor === false ? 'adult' : null
    const details = [
      dob ? `DOB ${text(dob)}` : null,
      minor,
      row.relationship ? text(row.relationship) : null,
      row.parentage ? `child of ${text(row.parentage)}` : null,
    ].filter(Boolean).join(', ')
    return details ? `${name} (${details})` : name
  }).join('; ')
}

function planningGoalsText(intake: Row | null): string {
  const planningGoals = intake?.planning_goals
  if (Array.isArray(planningGoals) && planningGoals.length > 0) {
    return planningGoals.map(String).join(', ')
  }
  return text(intake?.goals_notes ?? intake?.goals ?? intake?.planning_objectives)
}

export function formatIntakeQuestionnaire(intake: Row | null, pipeline?: Row | null): string {
  if (!intake) return 'INTAKE QUESTIONNAIRE: not available'
  const address = [intake.address_line1, intake.city, intake.state, intake.zip]
    .filter(Boolean)
    .join(', ')
  const spouse = intake.spouse_name ?? [intake.spouse_first_name, intake.spouse_last_name]
    .filter(Boolean)
    .join(' ')
  return `INTAKE QUESTIONNAIRE:
- Status: ${text(intake.status)}
- Client: ${fullName(intake)}; DOB ${text(intake.date_of_birth ?? pipeline?.client_dob)}; pronouns ${text(intake.preferred_pronoun)}
- Contact: ${text(intake.email)}; ${text(formatPhoneDisplay(intake.phone as string | null | undefined))}
- Address: ${text(address)}; County ${text(intake.county)}
- Marital status: ${text(intake.marital_status ?? pipeline?.marital_status)}; marriage date ${text(intake.date_of_marriage)}
- Spouse: ${text(spouse)}; DOB ${text(intake.spouse_date_of_birth)}; ${text(intake.spouse_email)}; ${text(formatPhoneDisplay(intake.spouse_phone as string | null | undefined))}
- Children: ${formatChildrenList(intake.children)}
- Minor children: ${text(intake.has_minor_children ?? pipeline?.has_minor_children)}
- Estate value: ${text(estateValueLabel(intake.estate_value) ?? intake.estate_value)}
- Planning goals: ${planningGoalsText(intake)}
- Financial details: ${text(intake.financial_details)}
- Excluded guardians: ${text(intake.excluded_guardian ?? intake.excluded_guardian_2)}
- Special notes: ${text(intake.special_notes ?? intake.special_circumstances)}
- Attorney review flags: ${text(intake.attorney_review_flags)}`
}

export function formatDesignSheetSummary(designSheet: Row | null): string {
  if (!designSheet) return 'DESIGN SHEET SUMMARY: not available'
  return `DESIGN SHEET SUMMARY:
- Status: ${text(designSheet.status)}
- Plan type: ${text(designSheet.plan_type)}; joint trust: ${text(designSheet.is_joint)}
- Client: ${text(designSheet.client_name)}; spouse: ${text(designSheet.spouse_name)}
- Trust name: ${text(designSheet.trust_name)}
- Children: ${formatChildrenList(designSheet.children)}
- Assets: ${text(designSheet.assets)}
- Goals notes: ${text(designSheet.goals_notes)}
- Concerns: ${text(designSheet.concerns)}
- Excluded guardians: ${designSheet.excluded_guardian_flag ? text(designSheet.excluded_guardian_name) : '-'}
- Trustee slots: ${text(designSheet.trustee_slots)}
- Personal representative slots: ${text(designSheet.executor_slots)}
- POA slots: ${text(designSheet.poa_slots)}
- HCP slots: ${text(designSheet.hcp_slots)}
- Guardian slots: ${text(designSheet.guardian_slots)}
- Spouse trustee slots: ${text(designSheet.spouse_trustee_slots)}
- Spouse PR slots: ${text(designSheet.spouse_executor_slots)}
- Spouse POA slots: ${text(designSheet.spouse_poa_slots)}
- Spouse HCP slots: ${text(designSheet.spouse_hcp_slots)}
${formatDesignSheetProvisions(designSheet)}`
}

/**
 * The provisions the sheet holds, as a compact list of the decisions actually
 * made.
 *
 * Only fields with a stored value are listed. A decisions getter answers with a
 * default for every unset key, so rendering through one would tell the assistant
 * that every provision on a blank sheet had already been decided — and the whole
 * point of showing it these fields is so it can tell settled from open.
 */
export function formatDesignSheetProvisions(designSheet: Row | null): string {
  if (!designSheet) return ''

  const decided: string[] = []
  for (const field of Object.keys(DESIGN_SHEET_DECISION_FIELDS)) {
    const value = readDecisionFieldRaw(
      designSheet as unknown as Pick<DesignSheet, 'decisions'>,
      field,
    )
    if (value === undefined || value === null || value === '') continue
    const meta = (DESIGN_SHEET_DECISION_FIELDS as Record<string, { label: string }>)[field]
    decided.push(`  - ${meta.label} (${field}): ${text(value)}`)
  }

  const columnProvisions = [
    ['Bond', designSheet.bond], ['Supervision', designSheet.supervision],
    ['UTMA age', designSheet.utma_age], ['No-contest clause', designSheet.no_contest_clause],
    ['PR structure', designSheet.pr_structure], ['Trustee structure', designSheet.trustee_structure],
    ['Beneficiary structure', designSheet.beneficiary_structure],
    ['Age distribution schedule', designSheet.age_distribution_schedule],
    ['Simultaneous death', designSheet.simultaneous_death],
    ['Distribution age', designSheet.distribution_age],
  ] as const
  for (const [label, value] of columnProvisions) {
    if (value === null || value === undefined || value === '') continue
    decided.push(`  - ${label}: ${text(value)}`)
  }

  if (decided.length === 0) {
    return 'PROVISIONS DECIDED SO FAR: none — every provision on this sheet is still open.'
  }
  return `PROVISIONS DECIDED SO FAR (anything not listed is still open):\n${decided.join('\n')}`
}

// --- System-skill-backed drafting instructions -------------------------------
// The instruction bodies live in tools/workflows/system/assistant/<slug>/SKILL.md
// (synced into work_skills as the runtime source of truth). These wrappers load
// the body and frame it as a system-prompt block.

export const DRAFTING_SUMMARY_SKILL_SLUG = 'design-sheet-drafting-summary'
export const TRUST_INTAKE_SKILL_SLUG = 'trust-drafting-intake'
export const INCAPACITY_SKILL_SLUG = 'incapacity-design-sheet'

export async function draftingSkillSummaryInstructions() {
  return `\n\n${await loadSystemSkillBody(DRAFTING_SUMMARY_SKILL_SLUG)}`
}

export async function trustDraftingIntakeInstructions() {
  return `\n\n${await loadSystemSkillBody(TRUST_INTAKE_SKILL_SLUG)}`
}

export async function incapacityDesignSheetInstructions() {
  return `\n\n${await loadSystemSkillBody(INCAPACITY_SKILL_SLUG, { TODAY: firmTodayKey() })}`
}

export function isDraftingSummaryRequest(message: string) {
  const normalized = message.toLowerCase()
  return normalized.includes('design sheet') &&
    normalized.includes('draft') &&
    (normalized.includes('claude') || normalized.includes('skill') || normalized.includes('document'))
}

// --- Normalized drafting payload formatters ----------------------------------

function yn(value: boolean) {
  return value ? 'Yes' : 'No'
}

function unknown(value: unknown) {
  if (value === null || value === undefined || value === '') return '[UNKNOWN]'
  if (Array.isArray(value)) return value.length ? value.join(', ') : '[UNKNOWN]'
  return String(value)
}

function includedDocuments(documents: DraftPayload['documents']) {
  const rows = [
    ['Revocable living trust', documents.include_trust],
    ['Pour-over will', documents.include_pour_over_will],
    ['Simple will', documents.include_simple_will],
    ['Testamentary trust will', documents.include_testamentary_trust_will],
    ['Durable power of attorney', documents.include_dpoa],
    ['Health care proxy', documents.include_hcp],
    ['HIPAA authorization', documents.include_hipaa],
    ['Advance health directive', documents.include_ahd],
    ['Personal property memorandum', documents.include_ppm],
    ['Parental guardian appointment', documents.include_parental_appointment],
    ['Temporary delegation of parental powers', documents.include_temp_delegation],
  ] as const

  const selected = rows.filter(([, enabled]) => enabled).map(([label]) => `- ${label}`)
  if (documents.spouse_docs) selected.push('- Spouse companion documents where applicable')
  return selected.length ? selected.join('\n') : '- [UNKNOWN]'
}

function findMissingValues(value: unknown, pathName = 'payload'): string[] {
  if (value === null || value === undefined || value === '') return [pathName]
  if (Array.isArray(value)) {
    if (value.length === 0) return []
    return value.flatMap((item, index) => findMissingValues(item, `${pathName}[${index}]`))
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .flatMap(([key, child]) => findMissingValues(child, `${pathName}.${key}`))
  }
  return []
}

/**
 * The factual, design-sheet-derived portion of the drafting payload — resolved
 * fiduciary names, trust/will/DPOA/HCP provisions, documents, and missing items.
 * Shared by the standalone "summarize for drafting" output and the matter chat
 * context so the trust/incapacity intake prompts can pre-fill from real values.
 */
export function draftPayloadFactSheet(payload: DraftPayload) {
  const missing = findMissingValues(payload)
    .filter(item => !item.includes('.notes') && !item.includes('.special_provisions'))
    .slice(0, 40)

  return `Matter snapshot:
- Matter ID: ${payload.matter.id}
- Matter number: ${unknown(payload.matter.matter_number)}
- Jurisdiction: Massachusetts
- Plan type: ${payload.matter.type}
- Practice area: ${unknown(payload.matter.practice_area)}
- Trust type: ${unknown(payload.matter.trust_type)}
- Minor children: ${yn(payload.matter.minor_children)}
- Client: ${payload.client.full_name}
- Client DOB: ${unknown(payload.client.dob)}
- Client address: ${unknown(payload.client.address)}, ${unknown(payload.client.city)}, ${unknown(payload.client.state)} ${unknown(payload.client.zip)}
- Spouse: ${payload.spouse ? payload.spouse.full_name : '[UNKNOWN or not applicable]'}
- Signing month/year: ${unknown(payload.execution.signing_month)} ${unknown(payload.execution.signing_year)}
- Signing county: ${unknown(payload.execution.signing_county)}
- Notary commission expiration: ${unknown(payload.execution.notary_commission_expiration)}

Documents to draft:
${includedDocuments(payload.documents)}

People and fiduciaries:
- Personal representative primary: ${unknown(payload.fiduciaries.pr_primary)}
- Personal representative successor: ${unknown(payload.fiduciaries.pr_successor)}
- Personal representative second successor: ${unknown(payload.fiduciaries.pr_second_successor)}
- Trustee initial: ${unknown(payload.fiduciaries.trustee_initial)}
- Co-trustee: ${unknown(payload.fiduciaries.trustee_co)}
- Trustee successor: ${unknown(payload.fiduciaries.trustee_successor)}
- DPOA primary agent: ${unknown(payload.fiduciaries.dpoa_primary)}
- DPOA co-agent: ${unknown(payload.fiduciaries.dpoa_co_agent)}
- DPOA successor: ${unknown(payload.fiduciaries.dpoa_successor)}
- Health care proxy primary: ${unknown(payload.fiduciaries.hcp_primary)}
- Health care proxy successor: ${unknown(payload.fiduciaries.hcp_successor)}
- Guardian primary: ${unknown(payload.fiduciaries.guardian_primary)}
- Guardian successor: ${unknown(payload.fiduciaries.guardian_successor)}
- Spouse PR primary: ${unknown(payload.fiduciaries.spouse_pr_primary)}
- Spouse PR successor: ${unknown(payload.fiduciaries.spouse_pr_successor)}
- Spouse DPOA primary: ${unknown(payload.fiduciaries.spouse_dpoa_primary)}
- Spouse DPOA successor: ${unknown(payload.fiduciaries.spouse_dpoa_successor)}
- Spouse HCP primary: ${unknown(payload.fiduciaries.spouse_hcp_primary)}
- Spouse HCP successor: ${unknown(payload.fiduciaries.spouse_hcp_successor)}
- Spouse trustee successor: ${unknown(payload.fiduciaries.spouse_trustee_successor)}

Document provisions:
- Trust name: ${unknown(payload.trust?.name)}
- Trust date: ${unknown(payload.trust?.date)}
- Distribution ages: ${unknown(payload.trust?.distribution_ages)}
- MA estate taxable: ${payload.trust ? yn(payload.trust.ma_estate_taxable) : '[UNKNOWN]'}
- MA estate tax savings approach: ${unknown(payload.trust?.ma_estate_tax_savings)}
- Separate trusts: ${payload.trust ? yn(payload.trust.separate_trusts) : '[UNKNOWN]'}
- ILIT: ${payload.trust ? yn(payload.trust.has_ilit) : '[UNKNOWN]'}
- ILIT trustee: ${unknown(payload.trust?.ilit_trustee)}
- PR structure: ${unknown(payload.will_provisions.pr_structure)}
- Trustee structure: ${unknown(payload.will_provisions.trustee_structure)}
- Co-trustee decision standard: ${unknown(payload.will_provisions.cotrustee_decision_standard)}
- Bond: ${payload.will_provisions.bond}
- Supervision: ${payload.will_provisions.supervision}
- Simultaneous death: ${unknown(payload.will_provisions.simultaneous_death)}
- UTMA age: ${payload.will_provisions.utma_age}
- No-contest clause: ${payload.will_provisions.no_contest_clause}
- Disclaimer article: ${yn(payload.will_provisions.include_disclaimer_article)}
- Self-proving affidavit: ${yn(payload.will_provisions.include_self_proving_affidavit)}
- Tangible property distribution: ${unknown(payload.will_provisions.tangible_property_distribution)}
- Pour-over alternate disposition: ${unknown(payload.will_provisions.pour_over_alternate_disposition)}
- Outright residuary: ${unknown(payload.will_provisions.outright_residuary)}
- Beneficiary structure: ${unknown(payload.will_provisions.beneficiary_structure)}
- Age distribution schedule: ${unknown(payload.will_provisions.age_distribution_schedule)}
- Trust protector: ${unknown(payload.will_provisions.trust_protector_name)}
- Pet care option: ${payload.will_provisions.pet_care_option}
- DPOA co-agent manner: ${payload.dpoa_provisions.coagent_manner}
- DPOA self-dealing reviewer: ${unknown(payload.dpoa_provisions.self_dealing_reviewer)}
- DPOA Section L: ${yn(payload.dpoa_provisions.include_section_l)}
- HCP anatomical gift: ${unknown(payload.hcp_provisions.anatomical_gift)}
- HIPAA psychotherapy notes: ${unknown(payload.hipaa_provisions.psychotherapy_notes)}
- Ancillary documents: ${unknown(payload.ancillary_docs)}
- Special provisions: ${unknown(payload.special_provisions)}

Missing or attorney-review items:
${missing.length ? missing.map(item => `- ${item}`).join('\n') : '- None flagged by the normalized payload.'}`
}

export function formatClaudeDraftingSkillInput(payload: DraftPayload) {
  return `Claude Drafting Skill Input

Role and task:
You are drafting Massachusetts estate-planning documents for Aubrey Law from attorney-approved design-sheet facts. Prepare draft-ready document instructions using only the facts below.

Non-invention rule:
Use only the provided facts. Do not invent names, dates, relationships, assets, tax conclusions, or fiduciary roles. If a value is missing or unclear, write [UNKNOWN] and preserve it as an attorney-review item.

${draftPayloadFactSheet(payload)}

Output requirements:
Draft clean, document-ready instructions for the selected Massachusetts estate-planning documents. Keep Massachusetts-specific assumptions explicit. Do not give client advice. Do not include facts not listed above.`
}
