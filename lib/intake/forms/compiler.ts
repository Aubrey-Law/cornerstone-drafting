import { type FormFieldId, getFormField, isDiscoveryField, MANDATORY_DISCOVERY_FIELDS } from '@/lib/discovery/catalog'
import { getIntakeBlock } from './blockRegistry'
import { parseIntakeFormDefinition } from './schema'
import type { IntakeBlockId, IntakeCondition, IntakeFormItem, IntakeFormSection, IntakeRequirement } from './types'

export type CompiledIntakeItem =
  | { kind: 'field'; id: string; fieldId: FormFieldId; label: string; helpText?: string; effectiveRequirement: IntakeRequirement; condition?: IntakeCondition }
  | { kind: 'block'; id: string; blockId: IntakeBlockId; title?: string; helpText?: string; config: Record<string, unknown>; condition?: IntakeCondition }

export interface CompiledIntakeSection extends Omit<IntakeFormSection, 'items'> {
  items: CompiledIntakeItem[]
}
export interface CompiledIntakeForm {
  purpose?: 'client_intake' | 'discovery_call'
  schemaVersion: 1
  key: string
  title: string
  description?: string
  audience: 'client' | 'staff'
  sections: CompiledIntakeSection[]
}
export interface IntakeFormDiagnostic { path: string; message: string }
export type CompileIntakeFormResult =
  | { success: true; form: CompiledIntakeForm }
  | { success: false; errors: IntakeFormDiagnostic[] }

const requirementRank: Record<IntakeRequirement, number> = { optional: 0, recommended: 1, required: 2 }
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** Resolve untrusted presentation data through the code catalogs before delivery. */
export function compileIntakeForm(raw: unknown, audience: 'client' | 'staff'): CompileIntakeFormResult {
  const parsed = parseIntakeFormDefinition(raw)
  if (!parsed.success) {
    return { success: false, errors: parsed.errors.map((error) => {
      const separator = error.indexOf(': ')
      return { path: error.slice(0, separator), message: error.slice(separator + 2) }
    }).sort(compareDiagnostics) }
  }
  const discovery = parsed.data.purpose === 'discovery_call'
  const errors: IntakeFormDiagnostic[] = []
  const sections: CompiledIntakeSection[] = []
  const usedFields = new Set<FormFieldId>()
  const earlierFields = new Map<FormFieldId, { shared: boolean }>()
  let hasSharedReview = false
  const error = (path: string, message: string) => { errors.push({ path, message }) }
  function checkCondition(condition: IntakeCondition | undefined, path: string, shared: boolean): void {
    if (!condition) return
    if ('conditions' in condition) {
      condition.conditions.forEach((child, i) => checkCondition(child, `${path}.conditions.${i}`, shared))
      return
    }
    const previous = earlierFields.get(condition.fieldId)
    if (!previous) error(path, `Condition field "${condition.fieldId}" must be available earlier in the form`)
    else if (shared && !previous.shared) error(path, `Condition field "${condition.fieldId}" is unavailable to clients`)
    let field
    try { field = getFormField(condition.fieldId) } catch { error(path, `Unknown builder condition field "${condition.fieldId}"`); return }
    if (condition.op === 'is_set') return
    if (field.control === 'boolean') {
      if (typeof condition.value !== 'boolean') error(`${path}.value`, 'Boolean conditions require a boolean value')
    } else if (typeof condition.value !== 'string' || field.control === 'multiselect') {
      error(`${path}.value`, 'This control does not support that condition value')
    } else if (field.options?.length && ![...field.options.map((o) => o.value), ...(field.legacyValues ?? [])].includes(condition.value)) {
      error(`${path}.value`, 'Condition value is not an approved option')
    }
  }
  parsed.data.sections.forEach((section, sectionIndex) => {
    const path = `sections.${sectionIndex}`
    const shared = section.audience === 'client_and_staff'
    if (discovery && shared) error(path, 'Discovery sections must be staff only')
    if (discovery && section.condition && section.items.some(item => item.kind === 'field' && MANDATORY_DISCOVERY_FIELDS.includes(item.fieldId as never))) error(path, 'Required discovery questions must be unconditional')
    checkCondition(section.condition, `${path}.condition`, shared)
    const items: CompiledIntakeItem[] = []
    section.items.forEach((item: IntakeFormItem, itemIndex) => {
      const itemPath = `${path}.items.${itemIndex}`
      checkCondition(item.condition, `${itemPath}.condition`, shared)
      if (item.kind === 'field') {
        if (discovery !== isDiscoveryField(item.fieldId)) error(itemPath, 'Field is not allowed for this form purpose')
        if (discovery && item.condition && MANDATORY_DISCOVERY_FIELDS.includes(item.fieldId as never)) error(itemPath, 'Required discovery questions must be unconditional')
        let field
        try { field = getFormField(item.fieldId) } catch { error(`${itemPath}.fieldId`, `Unknown builder field "${item.fieldId}"`); return }
        if (usedFields.has(item.fieldId)) error(`${itemPath}.fieldId`, `Single-use field "${item.fieldId}" is duplicated`)
        usedFields.add(item.fieldId)
        const effectiveRequirement = item.requirement ?? field.baselineRequirement
        if (requirementRank[effectiveRequirement] < requirementRank[field.baselineRequirement]) error(`${itemPath}.requirement`, 'Cannot weaken the catalog requirement')
        earlierFields.set(item.fieldId, { shared })
        items.push({ kind: 'field', id: item.id, fieldId: item.fieldId, label: item.labelOverride ?? field.label, effectiveRequirement,
          ...(item.helpText !== undefined ? { helpText: item.helpText } : {}), ...(item.condition ? { condition: clone(item.condition) } : {}) })
      } else {
        const block = getIntakeBlock(item.blockId)
        if (discovery) error(itemPath, 'Client intake blocks are unavailable in discovery forms')
        if (!block.audiences.includes(section.audience)) error(`${itemPath}.blockId`, 'Block does not support this section audience')
        const config = block.configSchema.safeParse(item.config ?? {})
        if (!config.success) config.error.issues.forEach((issue) => error(`${itemPath}.config${issue.path.length ? `.${issue.path.join('.')}` : ''}`, issue.message))
        if (item.blockId === 'review_submit' && shared && !section.condition && !item.condition) hasSharedReview = true
        items.push({ kind: 'block', id: item.id, blockId: item.blockId, config: config.success ? clone(config.data) : {},
          ...(item.titleOverride !== undefined ? { title: item.titleOverride } : {}), ...(item.helpText !== undefined ? { helpText: item.helpText } : {}), ...(item.condition ? { condition: clone(item.condition) } : {}) })
      }
    })
    if (audience === 'staff' || shared) sections.push({ ...clone(section), items })
  })
  if (discovery) for (const id of MANDATORY_DISCOVERY_FIELDS) if (!usedFields.has(id)) error('sections', `Required discovery question ${id} is missing`)
  if (!discovery && !hasSharedReview) error('sections', 'A shared unconditional review and submit path is required')
  if (errors.length) return { success: false, errors: errors.sort(compareDiagnostics) }
  return { success: true, form: { ...(parsed.data.purpose ? { purpose: parsed.data.purpose } : {}), schemaVersion: 1, key: parsed.data.key, title: parsed.data.title, audience, sections,
    ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}) } }
}

function compareDiagnostics(a: IntakeFormDiagnostic, b: IntakeFormDiagnostic): number {
  return a.path.localeCompare(b.path, 'en', { numeric: true }) || a.message.localeCompare(b.message, 'en')
}
