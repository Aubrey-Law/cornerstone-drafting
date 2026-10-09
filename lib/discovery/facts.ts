import type { DiscoveryAnswers } from './contracts'
export const FACT_FIELDS = ['firstName', 'lastName', 'email', 'phone', 'address', 'spouse', 'maritalStatus', 'hasMinorChildren'] as const
export type FactField = typeof FACT_FIELDS[number]
export const FACT_LABELS: Record<FactField,string> = {firstName:'First name',lastName:'Last name',email:'Email',phone:'Phone',address:'Address',spouse:'Spouse / partner',maritalStatus:'Marital status',hasMinorChildren:'Minor children'}
export type FactSnapshot = Record<FactField, unknown>
export type FactProposal = { field: FactField; current: unknown; proposed: unknown }
const text = (value: unknown) => typeof value === 'string' ? value.trim() || null : null
export function proposedFacts(answers: DiscoveryAnswers, current: FactSnapshot): FactProposal[] {
  const proposed: Partial<FactSnapshot> = {}
  for (const [field, id] of Object.entries({ firstName: 'first_name', lastName: 'last_name', email: 'email', phone: 'phone', maritalStatus: 'marital_status' })) {
    const key = `discovery_${id}`
    if (Object.hasOwn(answers, key)) proposed[field as FactField] = text(answers[key])
  }
  if (Object.hasOwn(answers, 'discovery_minor_children')) proposed.hasMinorChildren = answers.discovery_minor_children === 'yes' ? true : answers.discovery_minor_children === 'no' ? false : null
  for (const [field, mapping] of Object.entries({
    address: { addressLine1: 'address_line1', addressLine2: 'address_line2', city: 'city', state: 'state', zip: 'zip', county: 'county' },
    spouse: { firstName: 'spouse_first_name', lastName: 'spouse_last_name', email: 'spouse_email', phone: 'spouse_phone' },
  })) {
    const entries = Object.entries(mapping).filter(([, id]) => Object.hasOwn(answers, `discovery_${id}`))
    if (entries.length) proposed[field as FactField] = { ...(current[field as FactField] as object ?? {}), ...Object.fromEntries(entries.map(([key,id]) => [key, text(answers[`discovery_${id}`])])) }
  }
  return FACT_FIELDS.filter(field => Object.hasOwn(proposed, field) && JSON.stringify(proposed[field]) !== JSON.stringify(current[field]))
    .map(field => ({ field, current: current[field], proposed: proposed[field] }))
}
export function initialAnswers(facts: FactSnapshot): DiscoveryAnswers {
  const answers: DiscoveryAnswers = {}
  for (const [field, id] of Object.entries({ firstName: 'first_name', lastName: 'last_name', email: 'email', phone: 'phone', maritalStatus: 'marital_status' })) {
    if (typeof facts[field as FactField] === 'string') answers[`discovery_${id}`] = facts[field as FactField] as string
  }
  if (typeof facts.hasMinorChildren === 'boolean') answers.discovery_minor_children = facts.hasMinorChildren ? 'yes' : 'no'
  const address = facts.address as Record<string, unknown> | null, spouse = facts.spouse as Record<string, unknown> | null
  for (const [key, id] of Object.entries({ addressLine1: 'address_line1', addressLine2: 'address_line2', city: 'city', state: 'state', zip: 'zip', county: 'county' })) if (typeof address?.[key] === 'string') answers[`discovery_${id}`] = address[key] as string
  for (const [key, id] of Object.entries({ firstName: 'spouse_first_name', lastName: 'spouse_last_name', email: 'spouse_email', phone: 'spouse_phone' })) if (typeof spouse?.[key] === 'string') answers[`discovery_${id}`] = spouse[key] as string
  return answers
}
