import { z } from 'zod'
import type { IntakeRow } from '@/lib/intakeSections'
import { parsePlanningObjectives } from '@/lib/intakePlanningObjectives'
import { namedHipaaRecipients } from '@/lib/collegePrepFields'
import { validateIntakeField } from '@/lib/sharedFields/intakeValidate'
import { intakePlanTypeMapping, normalizeIntakePlanType } from '@/lib/intakePlanType'
import { getDocumentInclusions } from '@/lib/designSheetDocumentInclusions'
import type { IntakeAudience, IntakeBlockId } from './types'

export type { IntakeBlockId } from './types'

export interface IntakeSectionIssueDraft {
  message: string
  severity: 'error' | 'warning'
  blocksSubmission?: boolean
}

export interface BlockEvaluation {
  complete: boolean
  issues: IntakeSectionIssueDraft[]
}

export interface IntakeBlockDefinition<Config = Record<string, unknown>> {
  id: IntakeBlockId
  audiences: readonly IntakeAudience[]
  configSchema: z.ZodType<Config>
  evaluate: (config: Config, data: IntakeRow) => BlockEvaluation
  persistOnLeave: boolean
}

const EMPTY_CONFIG = z.object({}).strict()
const ADDRESS_CONFIG = z.object({ profile: z.enum(['estate', 'college']).optional(), includeCounty: z.boolean().optional() }).strict()
const SHARED_AUDIENCES = ['client_and_staff', 'staff_only'] as const

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(data: Record<string, unknown>, key: string): string {
  return typeof data[key] === 'string' ? data[key].trim() : ''
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object' && !Array.isArray(entry)) : []
}

function contactList(data: IntakeRow, key: string): Record<string, unknown>[] {
  return records(Array.isArray(data[`_${key}`]) ? data[`_${key}`] : record(data.fiduciary_entries)[key])
}

function named(data: IntakeRow, key: string): boolean {
  return contactList(data, key).some((entry) => text(entry, 'first_name') && text(entry, 'last_name'))
}

function reviewChoice(data: IntakeRow, key: string): boolean {
  const choice = text(record(data._review_choices), key) || text(record(data.review_choices), key)
  return choice === 'discuss_with_attorney' || choice === 'not_provided_yet'
}

function issue(message: string, severity: IntakeSectionIssueDraft['severity'] = 'error'): IntakeSectionIssueDraft {
  return { message, severity }
}

function result(issues: IntakeSectionIssueDraft[], complete = !issues.some((entry) => entry.severity === 'error')): BlockEvaluation {
  return { complete, issues }
}

function block(
  id: IntakeBlockId,
  evaluate: IntakeBlockDefinition['evaluate'],
  persistOnLeave = false,
  configSchema: IntakeBlockDefinition['configSchema'] = EMPTY_CONFIG,
): IntakeBlockDefinition {
  return { id, audiences: id.startsWith('attorney_') ? ['staff_only'] : SHARED_AUDIENCES, configSchema, evaluate, persistOnLeave }
}

const CLIENT_ROLES = [
  ['fid_personal_rep_client', 'Name a Personal Representative if you know who you want, or leave this blank to discuss later.'],
  ['fid_poa_client', 'Name a Financial Power of Attorney if you know who you want, or leave this blank to discuss later.'],
  ['fid_hcp_client', 'Name a Health Care Proxy if you know who you want, or leave this blank to discuss later.'],
  ['fid_trustee_client', 'Name a Trustee if you know who you want, or leave this blank to discuss later.'],
] as const
const SPOUSE_ROLES = [
  ['fid_personal_rep_spouse', "Name your spouse's Personal Representative if known, or leave this blank to discuss later."],
  ['fid_poa_spouse', "Name your spouse's Financial Power of Attorney if known, or leave this blank to discuss later."],
  ['fid_hcp_spouse', "Name your spouse's Health Care Proxy if known, or leave this blank to discuss later."],
] as const

/** The existing attorney document defaults, read without changing drafting data. */
export function getIntakeAttorneyDocumentInclusions(data: IntakeRow) {
  return getDocumentInclusions({
    plan_type: intakePlanTypeMapping(data.plan_type)?.designPlanType ?? null,
    marital_status: text(data, 'marital_status'),
    decisions: { document_inclusions: record(data.document_inclusions) },
    children: (data._children as unknown[]) ?? [],
  } as Parameters<typeof getDocumentInclusions>[0])
}

/** Code-owned rules only. No React, persistence keys, or executable form config. */
export const INTAKE_BLOCK_REGISTRY = {
  address: block('address', (config, data) => {
    const college = config.profile === 'college'
    const issues: IntakeSectionIssueDraft[] = []
    if (!(text(data, 'street_address') || text(data, 'address_line1'))) issues.push(issue(college ? "Enter the student's permanent street address." : 'Enter your street address.'))
    for (const [key, label] of [['city', 'city'], ['state', 'state'], ['zip', 'ZIP code']] as const) {
      if (!text(data, key)) issues.push(issue(`Enter ${college ? 'the' : 'your'} ${label}.`))
    }
    if (config.includeCounty !== false && !text(data, 'county')) issues.push(issue(college ? 'Select the Massachusetts county of the permanent address.' : 'Select your Massachusetts county.'))
    else if (config.includeCounty !== false) {
      const error = validateIntakeField('county', data.county)
      if (error) issues.push(issue(error))
    }
    return result(issues)
  }, false, ADDRESS_CONFIG),
  spouse_details: block('spouse_details', (_, data) => {
    const spouse = record(data._spouse)
    const spouseText = (key: string) => text(spouse, key) || text(data, `spouse_${key}`)
    const issues: IntakeSectionIssueDraft[] = []
    if (!spouseText('first_name')) issues.push(issue("Enter your spouse's first name."))
    if (!spouseText('last_name')) issues.push(issue("Enter your spouse's last name."))
    if (!spouseText('date_of_birth')) issues.push(issue("Enter your spouse's date of birth if you have it, or leave this blank to discuss later.", 'warning'))
    return result(issues)
  }, true),
  children: block('children', (_, data) => {
    const children = contactList(data, 'children')
    if (!children.length) return result([issue('Add at least one child.')])
    return result(children.flatMap((child, index) => {
      const issues: IntakeSectionIssueDraft[] = []
      if (!text(child, 'first_name') || !text(child, 'last_name')) issues.push(issue(`Enter first and last name for child ${index + 1}.`))
      if (!text(child, 'date_of_birth')) issues.push(issue(`Enter date of birth for child ${index + 1}.`, data.has_minor_children === true ? 'error' : 'warning'))
      return issues
    }))
  }, true),
  financial_assets: block('financial_assets', (_, data) => {
    const assets = Array.isArray(data.asset_types) ? data.asset_types : record(data.financial_details).asset_types
    return result(Array.isArray(assets) && assets.length ? [] : [issue('Select at least one asset type, or use Other Assets if none of the listed categories fit.')])
  }),
  planning_objectives: block('planning_objectives', (_, data) => result(
    text(parsePlanningObjectives(data.planning_objectives) ?? {}, 'why_now') ? [] : [issue('Briefly explain why you are moving forward with estate planning now.', 'warning')],
  )),
  existing_document_uploads: block('existing_document_uploads', () => result([])),
  additional_contacts: block('additional_contacts', (_, data) => result([], contactList(data, 'additional_contacts').length > 0), true),
  client_fiduciaries: block('client_fiduciaries', (_, data) => result(
    CLIENT_ROLES.flatMap(([key, message]) => named(data, key) ? [] : [issue(message, 'warning')]),
    CLIENT_ROLES.every(([key]) => named(data, key)) || reviewChoice(data, 'fiduciaries'),
  ), true),
  spouse_fiduciaries: block('spouse_fiduciaries', (_, data) => result(
    SPOUSE_ROLES.flatMap(([key, message]) => named(data, key) ? [] : [issue(message, 'warning')]),
    SPOUSE_ROLES.every(([key]) => named(data, key)) || reviewChoice(data, 'spouse_fiduciaries'),
  ), true),
  guardian: block('guardian', (_, data) => {
    if (reviewChoice(data, 'guardian')) return result([])
    const hasGuardian = named(data, 'fid_guardian_client')
    return result(hasGuardian ? [] : [issue(data.has_minor_children === true ? 'Name a guardian for your minor children.' : 'Name a guardian if you know who you want, or leave this blank to discuss later.', data.has_minor_children === true ? 'error' : 'warning')], hasGuardian)
  }, true),
  college_parents: block('college_parents', (_, data) => {
    const parents = contactList(data, 'additional_contacts').filter((entry) => text(entry, 'first_name') && text(entry, 'last_name'))
    if (!parents.length) return result([issue('Add at least one parent or guardian.')])
    return result(parents.flatMap((parent, index) => text(parent, 'phone') || text(parent, 'email') ? [] : [issue(`Add a phone number or email for ${text(parent, 'first_name') || `parent/guardian ${index + 1}`} — an agent we cannot reach is not much use in an emergency.`, 'warning')]))
  }, true),
  college_agents: block('college_agents', (_, data) => {
    if (reviewChoice(data, 'cp_agents')) return result([])
    const issues: IntakeSectionIssueDraft[] = []
    if (!named(data, 'fid_poa_client')) issues.push(issue('Name a financial agent under the durable power of attorney, or mark this to discuss at the meeting.', 'warning'))
    if (!named(data, 'fid_hcp_client')) issues.push(issue('Name a health care agent, or mark this to discuss at the meeting. Massachusetts allows only one agent at a time — name one agent and one alternate, not co-agents.', 'warning'))
    return result(issues, named(data, 'fid_poa_client') && named(data, 'fid_hcp_client'))
  }, true),
  college_hipaa_recipients: block('college_hipaa_recipients', (_, data) => {
    const recipients = data.college_hipaa_recipients !== undefined ? data.college_hipaa_recipients : record(data.college_prep_details).hipaa_recipients
    return result(reviewChoice(data, 'cp_agents') || namedHipaaRecipients(recipients).length ? [] : [issue('List everyone a provider should be allowed to talk to. This grants no decision-making power, so most families name more people here than hold the proxy.', 'warning')])
  }),
  review_submit: block('review_submit', (_, data) => result([], data.status === 'submitted' || data.status === 'approved')),
  attorney_plan_structure: block('attorney_plan_structure', (_, data) => result([], !!normalizeIntakePlanType(data.plan_type))),
  attorney_documents: block('attorney_documents', (_, data) => result([], Object.entries(getIntakeAttorneyDocumentInclusions(data)).some(([key, included]) => key !== 'spouse_docs' && included))),
} satisfies Record<IntakeBlockId, IntakeBlockDefinition>

export function getIntakeBlock(id: IntakeBlockId): IntakeBlockDefinition {
  if (!Object.prototype.hasOwnProperty.call(INTAKE_BLOCK_REGISTRY, id)) throw new Error(`Unknown intake block: ${id}`)
  return INTAKE_BLOCK_REGISTRY[id]
}

export function evaluateIntakeBlock(id: IntakeBlockId, config: unknown, data: IntakeRow): BlockEvaluation {
  const definition = getIntakeBlock(id)
  return definition.evaluate(definition.configSchema.parse(config ?? {}), data)
}

/** Adapters are supplied by the existing intake/matter-scoped contacts hook. */
export interface IntakeBlockPersistenceContext {
  saveSpouse: (value: Record<string, unknown>) => Promise<void>
  saveChildren: (value: Record<string, unknown>[]) => Promise<void>
  saveAdditionalContacts: (value: Record<string, unknown>[]) => Promise<void>
  saveFiduciaries: (entries: Array<Record<string, unknown> & { priority: number }>, role: string, party: 'client' | 'spouse') => Promise<void>
}

const SAVE_ROLES: Partial<Record<IntakeBlockId, readonly (readonly [string, 'client' | 'spouse'])[]>> = {
  client_fiduciaries: [['trustee', 'client'], ['personal_rep', 'client'], ['poa', 'client'], ['hcp', 'client']],
  spouse_fiduciaries: [['personal_rep', 'spouse'], ['poa', 'spouse'], ['hcp', 'spouse']],
  guardian: [['guardian', 'client']],
  college_agents: [['poa', 'client'], ['hcp', 'client']],
}

/** Fixed domain keys let the shell track edits without relying on section IDs. */
export function getIntakeBlockPersistenceSnapshot(id: IntakeBlockId, data: IntakeRow): string {
  const keys = id === 'spouse_details' ? ['_spouse']
    : id === 'children' ? ['_children']
    : id === 'additional_contacts' || id === 'college_parents' ? ['_additional_contacts']
    : (SAVE_ROLES[id] ?? []).map(([role, party]) => `_fid_${role}_${party}`)
  return JSON.stringify(keys.map((key) => data[key]))
}

export async function persistIntakeBlockOnLeave(id: IntakeBlockId, data: IntakeRow, context: IntakeBlockPersistenceContext, previousSnapshot?: string): Promise<void> {
  if (!getIntakeBlock(id).persistOnLeave) return
  if (id === 'spouse_details' && data._spouse) await context.saveSpouse(record(data._spouse))
  if (id === 'children' && data._children) await context.saveChildren(records(data._children))
  if (id === 'additional_contacts' || id === 'college_parents') await context.saveAdditionalContacts(records(data._additional_contacts))
  const previousValues: unknown[] | undefined = previousSnapshot === undefined ? undefined : JSON.parse(previousSnapshot)
  for (const [index, [role, party]] of (SAVE_ROLES[id] ?? []).entries()) {
    const value = data[`_fid_${role}_${party}`]
    // An absent role is never a deletion request. In the compiled shell the
    // saved baseline also distinguishes an edited clear from untouched []s.
    if (!Array.isArray(value) || (previousValues && JSON.stringify(value) === JSON.stringify(previousValues[index]))) continue
    const entries = records(value).filter((entry) => text(entry, 'first_name') || text(entry, 'last_name'))
    await context.saveFiduciaries(entries as Array<Record<string, unknown> & { priority: number }>, role, party)
  }
}
