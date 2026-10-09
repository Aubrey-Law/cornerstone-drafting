import { type FormFieldId, DISCOVERY_FIELD_IDS } from '@/lib/discovery/catalog'
import { z } from 'zod'
import { SHARED_FIELD_IDS } from '@aubrey-law/estate-fields/core'
import { collectConditionFieldIds } from './conditions'
import type { IntakeBlockId, IntakeCondition, IntakeFormDefinition, IntakeQuestionType } from './types'

const idSchema = z.string().min(1).max(80).refine((value) => value.trim().length > 0, 'Must not be blank')
const titleSchema = z.string().min(1).max(160)
const helpSchema = z.string().max(600)
const fieldIdSchema = z.enum([...SHARED_FIELD_IDS, ...DISCOVERY_FIELD_IDS] as [FormFieldId, ...FormFieldId[]])
const blockIds = [
  'address', 'spouse_details', 'children', 'financial_assets', 'planning_objectives',
  'existing_document_uploads', 'additional_contacts', 'client_fiduciaries',
  'spouse_fiduciaries', 'guardian', 'college_parents', 'college_agents',
  'college_hipaa_recipients', 'review_submit', 'attorney_plan_structure', 'attorney_documents',
] as const satisfies readonly IntakeBlockId[]
export const INTAKE_QUESTION_TYPES = [
  'short_text', 'long_text', 'single_choice', 'multiple_choice', 'yes_no', 'date', 'email', 'phone', 'number',
] as const satisfies readonly IntakeQuestionType[]

// Bound recursion while parsing, so malformed conditions cannot overflow the stack.
function conditionSchemaAtDepth(depth: number): z.ZodType<IntakeCondition> {
  const children = depth === 5
    ? z.never({ invalid_type_error: 'Condition nesting must not exceed 5 levels' })
    : conditionSchemaAtDepth(depth + 1)
  return z.discriminatedUnion('op', [
    z.object({ op: z.literal('equals'), fieldId: fieldIdSchema, value: z.union([z.string(), z.boolean()]) }).strict(),
    z.object({ op: z.literal('not_equals'), fieldId: fieldIdSchema, value: z.union([z.string(), z.boolean()]) }).strict(),
    z.object({ op: z.literal('is_set'), fieldId: fieldIdSchema }).strict(),
    z.object({ op: z.literal('all'), conditions: z.array(children).min(1) }).strict(),
    z.object({ op: z.literal('any'), conditions: z.array(children).min(1) }).strict(),
  ])
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
function isJsonValue(value: unknown): value is JsonValue {
  const active = new Set<object>()
  const pending: { value: unknown; leave?: boolean }[] = [{ value }]
  while (pending.length) {
    const entry = pending.pop()!
    const current = entry.value
    if (entry.leave) { active.delete(current as object); continue }
    if (current === null || typeof current === 'string' || typeof current === 'boolean') continue
    if (typeof current === 'number') { if (!Number.isFinite(current)) return false; continue }
    if (typeof current !== 'object') return false
    if (active.has(current)) return false
    if (!Array.isArray(current) && Object.getPrototypeOf(current) !== Object.prototype && Object.getPrototypeOf(current) !== null) return false
    active.add(current)
    pending.push({ value: current, leave: true })
    for (const key of Reflect.ownKeys(current)) {
      if (Array.isArray(current) && key === 'length') continue
      if (typeof key !== 'string') return false
      const property = Object.getOwnPropertyDescriptor(current, key)!
      if (!('value' in property)) return false
      pending.push({ value: property.value })
    }
  }
  return true
}
const jsonValueSchema = z.custom<JsonValue>(isJsonValue, 'Must be a serializable JSON value')
// Inspect the root descriptors/prototype before record parsing reads its values.
const configSchema = z.custom<Record<string, JsonValue>>(
  (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && isJsonValue(value),
  'Must be a serializable JSON object',
).pipe(z.record(jsonValueSchema))

const conditionSchema = conditionSchemaAtDepth(1)
const itemSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('field'), id: idSchema, fieldId: fieldIdSchema,
    labelOverride: titleSchema.optional(), helpText: helpSchema.optional(),
    requirement: z.enum(['optional', 'recommended', 'required']).optional(), condition: conditionSchema.optional(),
  }).strict(),
  z.object({
    kind: z.literal('block'), id: idSchema, blockId: z.enum(blockIds),
    titleOverride: titleSchema.optional(), helpText: helpSchema.optional(),
    config: configSchema.optional(), condition: conditionSchema.optional(),
  }).strict(),
  z.object({
    kind: z.literal('question'), id: idSchema, label: z.string().max(300), questionType: z.enum(INTAKE_QUESTION_TYPES),
    options: z.array(z.string().max(160)).max(50).optional(), required: z.boolean().optional(), helpText: helpSchema.optional(),
  }).strict(),
])

export const intakeFormDefinitionSchema: z.ZodType<IntakeFormDefinition> = z.object({
  purpose: z.enum(['client_intake', 'discovery_call', 'client_form']).optional(), schemaVersion: z.literal(1), key: idSchema, title: titleSchema, description: helpSchema.optional(),
  sections: z.array(z.object({
    id: idSchema, title: titleSchema, subtitle: helpSchema.optional(),
    timeEstimateMinutes: z.number().finite().nonnegative().optional(), optional: z.boolean().optional(),
    audience: z.enum(['client_and_staff', 'staff_only']), condition: conditionSchema.optional(),
    items: z.array(itemSchema).max(100),
  }).strict()).max(40),
}).strict()

export type ParseIntakeFormResult =
  | { success: true; data: IntakeFormDefinition }
  | { success: false; errors: string[] }

export function parseIntakeFormDefinition(raw: unknown): ParseIntakeFormResult {
  const parsed = intakeFormDefinitionSchema.safeParse(raw)
  if (!parsed.success) {
    return { success: false, errors: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'definition'}: ${issue.message}`) }
  }
  const errors: string[] = []
  const sectionIds = new Set<string>()
  const itemIds = new Set<string>()
  parsed.data.sections.forEach((section, sectionIndex) => {
    const sectionPath = `sections.${sectionIndex}`
    if (sectionIds.has(section.id)) errors.push(`${sectionPath}.id: Duplicate section ID "${section.id}"`)
    sectionIds.add(section.id)
    section.items.forEach((item, itemIndex) => {
      const itemPath = `${sectionPath}.items.${itemIndex}`
      if (itemIds.has(item.id)) errors.push(`${itemPath}.id: Duplicate item ID "${item.id}"`)
      itemIds.add(item.id)
      if (item.kind === 'field' && collectConditionFieldIds(item.condition).includes(item.fieldId)) {
        errors.push(`${itemPath}.condition: An item cannot condition its visibility on its own field`)
      }
    })
  })
  return errors.length ? { success: false, errors } : { success: true, data: parsed.data }
}
