import { getFormField as getBuilderField } from '@/lib/discovery/catalog'
import { getIntakeBlock } from './blockRegistry'
import { getIntakeFormBuilderCatalog, type BuilderCatalogField } from './builderCatalog'
import type { IntakeFormDefinition, IntakeFormItem, IntakeFormSection } from './types'

export type EditorSelection =
  | { kind: 'form' }
  | { kind: 'section'; sectionId: string }
  | { kind: 'item'; sectionId: string; itemId: string }

export type DiagnosticTarget = EditorSelection & { control: string }
export type EditorIdFactory = () => string
export type NewSection = Omit<IntakeFormSection, 'id' | 'items'>
export type NewItem =
  | Omit<Extract<IntakeFormItem, { kind: 'field' }>, 'id'>
  | Omit<Extract<IntakeFormItem, { kind: 'block' }>, 'id'>
export type ItemPatch =
  | Partial<Omit<Extract<IntakeFormItem, { kind: 'field' }>, 'id' | 'kind' | 'fieldId'>>
  | Partial<Omit<Extract<IntakeFormItem, { kind: 'block' }>, 'id' | 'kind' | 'blockId'>>

const clone = <T>(value: T): T => structuredClone(value)

function generatedId(definition: IntakeFormDefinition, prefix: 'section' | 'item', factory: EditorIdFactory): string {
  const base = `${prefix}_${factory().replaceAll('-', '')}`
  if (base.length > 80 || base === `${prefix}_`) throw new Error('ID factory must produce a nonempty identifier under 80 characters')
  const used = new Set(definition.sections.flatMap(section => [section.id, ...section.items.map(item => item.id)]))
  let id = base
  let suffix = 2
  while (used.has(id)) {
    const ending = `_${suffix++}`
    id = `${base.slice(0, 80 - ending.length)}${ending}`
  }
  return id
}

function boundedIndex(index: number, length: number): number {
  return Math.min(length, Math.max(0, Number.isNaN(index) ? 0 : Math.trunc(index)))
}

function sectionIndex(definition: IntakeFormDefinition, id: string): number {
  const index = definition.sections.findIndex(section => section.id === id)
  if (index === -1) throw new Error(`Unknown section "${id}"`)
  return index
}

function itemLocation(definition: IntakeFormDefinition, id: string): { sectionIndex: number; itemIndex: number } {
  for (let sectionIndex = 0; sectionIndex < definition.sections.length; sectionIndex++) {
    const itemIndex = definition.sections[sectionIndex].items.findIndex(item => item.id === id)
    if (itemIndex !== -1) return { sectionIndex, itemIndex }
  }
  throw new Error(`Unknown item "${id}"`)
}

export function createBlankDefinition(input: Pick<IntakeFormDefinition, 'key' | 'title' | 'description' | 'purpose'>): IntakeFormDefinition {
  return { schemaVersion: 1, ...input, sections: [] }
}

export function addSection(definition: IntakeFormDefinition, input: NewSection, factory: EditorIdFactory = () => globalThis.crypto.randomUUID()): IntakeFormDefinition {
  const section: IntakeFormSection = { ...clone(input), id: generatedId(definition, 'section', factory), items: [] }
  return { ...definition, sections: [...definition.sections, section] }
}

export function updateSection(definition: IntakeFormDefinition, id: string, patch: Partial<NewSection>): IntakeFormDefinition {
  const index = sectionIndex(definition, id)
  return { ...definition, sections: definition.sections.map((section, i) => i === index ? { ...section, ...clone(patch), id: section.id, items: section.items } : section) }
}

export function removeSection(definition: IntakeFormDefinition, id: string): IntakeFormDefinition {
  const index = sectionIndex(definition, id)
  return { ...definition, sections: definition.sections.filter((_, i) => i !== index) }
}

export function moveSection(definition: IntakeFormDefinition, id: string, toIndex: number): IntakeFormDefinition {
  const from = sectionIndex(definition, id)
  const sections = [...definition.sections]
  const [section] = sections.splice(from, 1)
  sections.splice(boundedIndex(toIndex, sections.length), 0, section)
  return { ...definition, sections }
}

export function addItem(definition: IntakeFormDefinition, sectionId: string, input: NewItem, factory: EditorIdFactory = () => globalThis.crypto.randomUUID()): IntakeFormDefinition {
  const index = sectionIndex(definition, sectionId)
  if (input.kind === 'field') {
    getBuilderField(input.fieldId)
    if (definition.sections.some(section => section.items.some(item => item.kind === 'field' && item.fieldId === input.fieldId))) {
      throw new Error(`Field "${input.fieldId}" is already used in this form`)
    }
  } else if (!getIntakeBlock(input.blockId).audiences.includes(definition.sections[index].audience)) {
    throw new Error('Block does not support this section audience')
  }
  const item: IntakeFormItem = { ...clone(input), id: generatedId(definition, 'item', factory) }
  return { ...definition, sections: definition.sections.map((section, i) => i === index ? { ...section, items: [...section.items, item] } : section) }
}

export function updateItem(definition: IntakeFormDefinition, id: string, patch: ItemPatch): IntakeFormDefinition {
  const location = itemLocation(definition, id)
  return { ...definition, sections: definition.sections.map((section, s) => s === location.sectionIndex ? {
    ...section, items: section.items.map((item, i) => i === location.itemIndex ? {
      ...item, ...clone(patch), id: item.id, kind: item.kind,
      ...(item.kind === 'field' ? { fieldId: item.fieldId } : { blockId: item.blockId }),
    } as IntakeFormItem : item),
  } : section) }
}

export function removeItem(definition: IntakeFormDefinition, id: string): IntakeFormDefinition {
  const location = itemLocation(definition, id)
  return { ...definition, sections: definition.sections.map((section, s) => s === location.sectionIndex ? {
    ...section, items: section.items.filter((_, i) => i !== location.itemIndex),
  } : section) }
}

/** toIndex is an insertion boundary in the destination's original list. */
export function moveItem(definition: IntakeFormDefinition, move: { itemId: string; toSectionId: string; toIndex: number }): IntakeFormDefinition {
  const from = itemLocation(definition, move.itemId)
  const to = sectionIndex(definition, move.toSectionId)
  const destinationIndex = boundedIndex(move.toIndex, definition.sections[to].items.length)
  const sections = [...definition.sections]
  const sourceItems = [...sections[from.sectionIndex].items]
  const [item] = sourceItems.splice(from.itemIndex, 1)
  sections[from.sectionIndex] = { ...sections[from.sectionIndex], items: sourceItems }
  const destinationItems = from.sectionIndex === to ? sourceItems : [...sections[to].items]
  const adjustedIndex = from.sectionIndex === to && destinationIndex > from.itemIndex ? destinationIndex - 1 : destinationIndex
  destinationItems.splice(adjustedIndex, 0, item)
  sections[to] = { ...sections[to], items: destinationItems }
  return { ...definition, sections }
}

/** Preserve valid selection; otherwise choose the next sibling, previous sibling, or parent. */
export function selectionAfterRemoval(before: IntakeFormDefinition, after: IntakeFormDefinition, selection: EditorSelection): EditorSelection {
  if (selection.kind === 'form') return selection
  if (selection.kind === 'item') {
    for (const section of after.sections) {
      if (section.items.some(item => item.id === selection.itemId)) return { ...selection, sectionId: section.id }
    }
  }
  const section = after.sections.find(section => section.id === selection.sectionId)
  if (section) {
    if (selection.kind === 'section') return selection
    const oldIndex = before.sections.find(section => section.id === selection.sectionId)?.items.findIndex(item => item.id === selection.itemId) ?? 0
    const item = section.items[boundedIndex(oldIndex, Math.max(0, section.items.length - 1))]
    return item ? { kind: 'item', sectionId: section.id, itemId: item.id } : { kind: 'section', sectionId: section.id }
  }
  const oldIndex = before.sections.findIndex(section => section.id === selection.sectionId)
  const next = after.sections[boundedIndex(oldIndex, Math.max(0, after.sections.length - 1))]
  return next ? { kind: 'section', sectionId: next.id } : { kind: 'form' }
}

/** Stored invalid conditions are deliberately retained; only new choices are constrained. */
export function eligibleConditionFields(definition: IntakeFormDefinition, selection: EditorSelection, fields: readonly BuilderCatalogField[] = getIntakeFormBuilderCatalog().fields): BuilderCatalogField[] {
  if (selection.kind === 'form') return []
  const targetSectionIndex = definition.sections.findIndex(section => section.id === selection.sectionId)
  if (targetSectionIndex === -1) return []
  const targetSection = definition.sections[targetSectionIndex]
  const targetItemIndex = selection.kind === 'item' ? targetSection.items.findIndex(item => item.id === selection.itemId) : 0
  if (targetItemIndex === -1) return []
  const approved = new Map(fields.filter(field => field.control !== 'multiselect').map(field => [field.id, field]))
  const found = new Map<string, BuilderCatalogField>()
  for (let s = 0; s <= targetSectionIndex; s++) {
    const section = definition.sections[s]
    if (targetSection.audience === 'client_and_staff' && section.audience === 'staff_only') continue
    const items = s === targetSectionIndex ? section.items.slice(0, targetItemIndex) : section.items
    for (const item of items) {
      if (item.kind !== 'field') continue
      const field = approved.get(item.fieldId)
      if (field?.audiences.includes(targetSection.audience)) found.set(item.fieldId, field)
    }
  }
  return [...found.values()]
}

export function targetForDiagnostic(path: string, definition: IntakeFormDefinition): DiagnosticTarget {
  const parts = path.split('.')
  if (parts[0] !== 'sections' || parts.length === 1) return { kind: 'form', control: parts[0] || 'definition' }
  const index = /^\d+$/.test(parts[1]) ? Number(parts[1]) : -1
  const section = definition.sections[index]
  if (!section) return { kind: 'form', control: 'definition' }
  if (parts[2] !== 'items' || parts.length === 3) return { kind: 'section', sectionId: section.id, control: parts[2] || 'title' }
  const itemIndex = /^\d+$/.test(parts[3] ?? '') ? Number(parts[3]) : -1
  const item = section.items[itemIndex]
  if (!item) return { kind: 'section', sectionId: section.id, control: 'items' }
  return { kind: 'item', sectionId: section.id, itemId: item.id, control: parts[4] || (item.kind === 'field' ? 'labelOverride' : 'titleOverride') }
}

/** Browser-safe comparison of JSON definitions; array order remains significant. */
export function definitionFingerprint(definition: IntakeFormDefinition): string {
  function sorted(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sorted)
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>
      return Object.fromEntries(Object.keys(record).sort().map(key => [key, sorted(record[key])]))
    }
    return value
  }
  return JSON.stringify(sorted(definition))
}
