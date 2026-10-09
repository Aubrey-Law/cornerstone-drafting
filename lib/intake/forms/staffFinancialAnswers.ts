import { z } from 'zod'
import { INTAKE_ASSET_TOTALS_KEYS, INTAKE_ASSET_TYPE_VALUES, SPECIAL_CIRCUMSTANCE_OPTIONS } from '@aubrey-law/estate-fields/core'
import { isFinancialDetailsRootKey } from '@/lib/intakeFinancialFields'

const text = z.string().max(20000)
const id = z.string().min(1).max(100)
const rowSchemas = {
  real_estate: z.object({ id, type: text, address: text, owner: text, value: text, mortgage: text, notes: text }).strict(),
  business_interests: z.object({ id, name: text, business_type: text, interest_pct: text, value: text, owner: text }).strict(),
  liabilities: z.object({ id, description: text, value: text, owner: text }).strict(),
}
const totalsSchema = z.object({ client_total: text, spouse_total: text, joint_total: text }).strict()
const circumstances = new Set(SPECIAL_CIRCUMSTANCE_OPTIONS.map(option => option.value))
const totals = new Set<string>(INTAKE_ASSET_TOTALS_KEYS)
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const rowSchema = (key: string) => Object.prototype.hasOwnProperty.call(rowSchemas, key) ? rowSchemas[key as keyof typeof rowSchemas] : null

/** Expand only financial storage; leave hydrated contacts and other answers untouched. */
export function withStaffFinancialAnswers(data: Record<string, unknown>): Record<string, unknown> {
  const expanded = { ...data }
  if (record(data.financial_details)) {
    for (const [key, value] of Object.entries(data.financial_details)) {
      expanded[isFinancialDetailsRootKey(key) ? key : `financial_${key}`] = value
    }
  }
  return expanded
}

/** Project editable properties only; the server restores saved metadata. */
export function financialEditValue(changes: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(changes).map(([uiKey, value]) => {
    const key = isFinancialDetailsRootKey(uiKey) ? uiKey : uiKey.replace(/^financial_/, '')
    const schema = rowSchema(key)
    if (schema && Array.isArray(value)) value = value.map(row => record(row)
      ? Object.fromEntries(Object.keys(schema.shape).map(name => [name, row[name] ?? ''])) : row)
    else if (totals.has(key) && record(value)) {
      const saved = value
      value = Object.fromEntries(Object.keys(totalsSchema.shape).map(name => [name, saved[name] ?? '']))
    }
    else if (key === 'circumstance_details' && record(value)) value = Object.fromEntries(Object.entries(value).filter(([name]) => circumstances.has(name)))
    return [key, value]
  }))
}

export function mergeStaffFinancialAnswers(value: unknown, stored: unknown): Record<string, unknown> {
  if (!record(value) || Object.keys(value).length > 30) throw new Error('Enter valid financial answers.')
  if (stored != null && !record(stored)) throw new Error('The saved financial answers need review before editing.')
  const result = { ...(stored ?? {}) } as Record<string, unknown>
  for (const [key, incoming] of Object.entries(value)) {
    const schema = rowSchema(key)
    if (schema) {
      const parsed = z.array(schema).max(100).safeParse(incoming)
      if (!parsed.success || new Set(parsed.data.map(row => row.id)).size !== parsed.data.length) throw new Error('Check the financial entries: each needs a unique ID and text answers, with no more than 100 entries.')
      const old = result[key]
      if (old != null && (!Array.isArray(old) || old.some(row => !record(row) || typeof row.id !== 'string' || !row.id)
        || new Set(old.map(row => row.id)).size !== old.length)) throw new Error('The saved financial entries need review before editing.')
      const previous = new Map<string, Record<string, unknown>>((old ?? []).map((row: Record<string, unknown>) => [row.id as string, row]))
      result[key] = parsed.data.map(row => ({ ...previous.get(row.id), ...row }))
    } else if (totals.has(key)) {
      const parsed = totalsSchema.safeParse(incoming)
      if (!parsed.success) throw new Error('Enter text for client, spouse, and joint totals.')
      if (result[key] != null && !record(result[key])) throw new Error('The saved totals need review before editing.')
      result[key] = { ...(result[key] as Record<string, unknown> ?? {}), ...parsed.data }
    } else if (key === 'asset_types') {
      if (!Array.isArray(incoming) || incoming.length > INTAKE_ASSET_TYPE_VALUES.length || incoming.some(item => typeof item !== 'string' || !INTAKE_ASSET_TYPE_VALUES.includes(item))
        || new Set(incoming).size !== incoming.length) throw new Error('Choose available asset types.')
      result[key] = incoming
    } else if (circumstances.has(key)) {
      if (typeof incoming !== 'boolean') throw new Error('Answer each special circumstance with yes or no.')
      result[key] = incoming
    } else if (key === 'circumstance_details') {
      if (!record(incoming) || Object.entries(incoming).some(([name, answer]) => !circumstances.has(name) || !text.safeParse(answer).success)) throw new Error('Enter valid special circumstance details.')
      if (result[key] != null && !record(result[key])) throw new Error('The saved circumstance details need review before editing.')
      result[key] = { ...(result[key] as Record<string, unknown> ?? {}), ...incoming }
    } else if (key === 'personal_property' || key === 'other_assets') {
      if (!text.safeParse(incoming).success) throw new Error('Enter text for the asset description.')
      result[key] = incoming
    } else throw new Error('This financial answer cannot be edited here.')
  }
  return result
}

/** Prevent malformed historical groups from crashing the shared financial controls. */
export function staffFinancialReadError(data: Record<string, unknown>): string | null {
  if (data.financial_details != null && !record(data.financial_details)) return 'The saved financial answers need review before editing.'
  const expanded = withStaffFinancialAnswers(data)
  const known: Record<string, unknown> = {}
  for (const key of ['asset_types', ...circumstances, ...Object.keys(rowSchemas).map(key => `financial_${key}`), ...[...totals].map(key => `financial_${key}`), 'financial_circumstance_details', 'financial_personal_property', 'financial_other_assets']) {
    if (expanded[key] != null) known[key] = expanded[key]
  }
  try { mergeStaffFinancialAnswers(financialEditValue(known), data.financial_details); return null }
  catch { return 'The saved financial answers need review before editing.' }
}
