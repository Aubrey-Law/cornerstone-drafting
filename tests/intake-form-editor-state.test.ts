import { describe, expect, it, vi } from 'vitest'
import {
  addItem, addSection, createBlankDefinition, definitionFingerprint, eligibleConditionFields,
  moveItem, moveSection, removeItem, removeSection, selectionAfterRemoval, targetForDiagnostic,
  updateItem, updateSection,
} from '@/lib/intake/forms/editorState'
import { compileIntakeForm } from '@/lib/intake/forms/compiler'
import type { IntakeFormDefinition } from '@/lib/intake/forms/types'

function fixture(): IntakeFormDefinition {
  return { schemaVersion: 1, key: 'estate', title: 'Estate', sections: [
    { id: 'personal', title: 'Personal', audience: 'client_and_staff', items: [
      { kind: 'field', id: 'county', fieldId: 'county' },
      { kind: 'field', id: 'parent', fieldId: 'has_children' },
    ] },
    { id: 'family', title: 'Family', audience: 'client_and_staff', items: [
      { kind: 'block', id: 'children', blockId: 'children', condition: { op: 'equals', fieldId: 'has_children', value: true } },
      { kind: 'block', id: 'submit', blockId: 'review_submit' },
      { kind: 'block', id: 'guardian', blockId: 'guardian' },
    ] },
  ] }
}

describe('immutable intake editor operations', () => {
  it('creates structurally valid blank drafts that retain compiler diagnostics', () => {
    const blank = createBlankDefinition({ key: 'new_form', title: 'New form' })
    expect(blank).toEqual({ schemaVersion: 1, key: 'new_form', title: 'New form', sections: [] })
    expect(compileIntakeForm(blank, 'client')).toMatchObject({ success: false, errors: [{ path: 'sections' }] })
  })

  it('returns a new root for every edit without mutating the input', () => {
    const original = fixture()
    const before = structuredClone(original)
    const operations = [
      () => addSection(original, { title: 'More', audience: 'staff_only' }, () => 'abc-def'),
      () => updateSection(original, 'personal', { title: 'Your details' }),
      () => removeSection(original, 'family'),
      () => moveSection(original, 'family', 0),
      () => addItem(original, 'personal', { kind: 'field', fieldId: 'client_email' }, () => 'abc-def'),
      () => updateItem(original, 'children', { helpText: 'Tell us about your children' }),
      () => removeItem(original, 'county'),
      () => moveItem(original, { itemId: 'county', toSectionId: 'family', toIndex: 0 }),
    ]
    for (const operation of operations) {
      expect(operation()).not.toBe(original)
      expect(original).toEqual(before)
    }
  })

  it('clamps section ordering and preserves section identity', () => {
    const original = fixture()
    const moved = moveSection(original, 'family', -1)
    expect(moved.sections.map(s => s.id)).toEqual(['family', 'personal'])
    expect(moved.sections[0]).toBe(original.sections[1])
    expect(moveSection(original, 'personal', 99).sections.map(s => s.id)).toEqual(['family', 'personal'])
  })

  it('moves an item once across sections without changing its object or ID', () => {
    const original = fixture()
    const moved = moveItem(original, { itemId: 'county', toSectionId: 'family', toIndex: -4 })
    expect(moved.sections[0].items.map(i => i.id)).toEqual(['parent'])
    expect(moved.sections[1].items.map(i => i.id)).toEqual(['county', 'children', 'submit', 'guardian'])
    expect(moved.sections[1].items[0]).toBe(original.sections[0].items[0])
  })

  it('adjusts same-list insertion boundaries and clamps the end', () => {
    const original = fixture()
    expect(moveItem(original, { itemId: 'children', toSectionId: 'family', toIndex: 2 })
      .sections[1].items.map(i => i.id)).toEqual(['submit', 'children', 'guardian'])
    expect(moveItem(original, { itemId: 'children', toSectionId: 'family', toIndex: 99 })
      .sections[1].items.map(i => i.id)).toEqual(['submit', 'guardian', 'children'])
    expect(moveItem(original, { itemId: 'guardian', toSectionId: 'family', toIndex: 0 })
      .sections[1].items.map(i => i.id)).toEqual(['guardian', 'children', 'submit'])
  })

  it('generates globally unique IDs, strips hyphens, and retains IDs through edits', () => {
    const first = addSection(fixture(), { title: 'New', audience: 'client_and_staff' }, () => '1234-5678')
    expect(first.sections[2].id).toBe('section_12345678')
    const second = addSection(first, { title: 'Another', audience: 'staff_only' }, () => '1234-5678')
    expect(new Set(second.sections.map(s => s.id)).size).toBe(4)
    const withItem = addItem(second, 'personal', { kind: 'field', fieldId: 'client_email' }, () => '1234-5678')
    expect(withItem.sections[0].items[2].id).toBe('item_12345678')
    const again = addItem(withItem, 'family', { kind: 'block', blockId: 'address' }, () => '1234-5678')
    const ids = again.sections.flatMap(s => [s.id, ...s.items.map(i => i.id)])
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every(id => id.length <= 80)).toBe(true)
    expect(updateItem(again, 'item_12345678', { labelOverride: 'Email address' }).sections[0].items[2])
      .toMatchObject({ id: 'item_12345678', fieldId: 'client_email', labelOverride: 'Email address' })
    const generated = addSection(fixture(), { title: 'Generated', audience: 'staff_only' })
    expect(generated.sections[2].id).toMatch(/^section_[a-f0-9]{32}$/)
  })

  it('prevents global duplicate fields and unapproved additions', () => {
    expect(() => addItem(fixture(), 'family', { kind: 'field', fieldId: 'county' })).toThrow(/already/)
    expect(() => addItem(fixture(), 'family', { kind: 'field', fieldId: 'client_name' })).toThrow()
    expect(() => addItem(fixture(), 'family', { kind: 'block', blockId: 'attorney_documents' })).toThrow(/audience/)
  })

  it('protects existing identities even when a wider patch object is supplied', () => {
    const sectionPatch = { id: 'different_section', title: 'Updated', items: [] }
    const itemPatch = { id: 'different_item', fieldId: 'county', kind: 'block', helpText: 'Updated' }
    expect(updateSection(fixture(), 'personal', sectionPatch).sections[0])
      .toMatchObject({ id: 'personal', title: 'Updated', items: [{ id: 'county' }, { id: 'parent' }] })
    expect(updateItem(fixture(), 'parent', itemPatch).sections[0].items[1])
      .toMatchObject({ id: 'parent', kind: 'field', fieldId: 'has_children', helpText: 'Updated' })
  })

  it('clones nested additions and updates so caller changes cannot alter editor state', () => {
    const condition = { op: 'equals' as const, fieldId: 'has_children' as const, value: true }
    const added = addSection(fixture(), { title: 'Dependent', audience: 'client_and_staff', condition }, () => 'new')
    condition.value = false
    expect(added.sections[2].condition).toMatchObject({ value: true })
    const config = { profile: 'college' }
    const itemAdded = addItem(fixture(), 'personal', { kind: 'block', blockId: 'address', config }, () => 'new')
    config.profile = 'estate'
    expect(itemAdded.sections[0].items[2]).toMatchObject({ config: { profile: 'college' } })
    const updated = updateItem(fixture(), 'children', { condition })
    condition.value = true
    expect(updated.sections[1].items[0].condition).toMatchObject({ value: false })
    const sectionUpdated = updateSection(fixture(), 'family', { condition })
    condition.value = false
    expect(sectionUpdated.sections[1].condition).toMatchObject({ value: true })
  })

  it('repairs section selection to next, previous, then form after removal', () => {
    const original = fixture()
    expect(selectionAfterRemoval(original, removeSection(original, 'personal'), { kind: 'section', sectionId: 'personal' }))
      .toEqual({ kind: 'section', sectionId: 'family' })
    expect(selectionAfterRemoval(original, removeSection(original, 'family'), { kind: 'item', sectionId: 'family', itemId: 'children' }))
      .toEqual({ kind: 'section', sectionId: 'personal' })
    const only = removeSection(original, 'family')
    expect(selectionAfterRemoval(only, removeSection(only, 'personal'), { kind: 'section', sectionId: 'personal' })).toEqual({ kind: 'form' })
  })

  it('repairs item selection to next, previous, then containing section', () => {
    const original = fixture()
    expect(selectionAfterRemoval(original, removeItem(original, 'county'), { kind: 'item', sectionId: 'personal', itemId: 'county' }))
      .toEqual({ kind: 'item', sectionId: 'personal', itemId: 'parent' })
    expect(selectionAfterRemoval(original, removeItem(original, 'parent'), { kind: 'item', sectionId: 'personal', itemId: 'parent' }))
      .toEqual({ kind: 'item', sectionId: 'personal', itemId: 'county' })
    const only = removeItem(original, 'county')
    expect(selectionAfterRemoval(only, removeItem(only, 'parent'), { kind: 'item', sectionId: 'personal', itemId: 'parent' }))
      .toEqual({ kind: 'section', sectionId: 'personal' })
    expect(selectionAfterRemoval(original, removeItem(original, 'county'), { kind: 'item', sectionId: 'family', itemId: 'children' }))
      .toEqual({ kind: 'item', sectionId: 'family', itemId: 'children' })
  })
})

describe('condition choices and diagnostics', () => {
  it('offers only earlier approved scalar fields visible to the dependent audience', () => {
    const definition = fixture()
    definition.sections.unshift({ id: 'internal', title: 'Internal', audience: 'staff_only', items: [
      { kind: 'field', id: 'email', fieldId: 'client_email' },
      { kind: 'field', id: 'assets', fieldId: 'asset_types' },
      { kind: 'field', id: 'unapproved', fieldId: 'client_name' },
    ] })
    expect(eligibleConditionFields(definition, { kind: 'item', sectionId: 'family', itemId: 'children' }).map(f => f.id))
      .toEqual(['county', 'has_children'])
    expect(eligibleConditionFields(definition, { kind: 'item', sectionId: 'personal', itemId: 'parent' }).map(f => f.id))
      .toEqual(['county'])
    expect(eligibleConditionFields(definition, { kind: 'section', sectionId: 'personal' })).toEqual([])
    definition.sections[2].audience = 'staff_only'
    expect(eligibleConditionFields(definition, { kind: 'section', sectionId: 'family' }).map(f => f.id))
      .toEqual(['client_email', 'county', 'has_children'])
    expect(eligibleConditionFields(definition, { kind: 'form' })).toEqual([])
  })

  it('retains invalid stored conditions when the source moves after its dependent', () => {
    const original = fixture()
    const moved = moveItem(original, { itemId: 'parent', toSectionId: 'family', toIndex: 1 })
    expect(moved.sections[1].items[0].condition).toEqual({ op: 'equals', fieldId: 'has_children', value: true })
    expect(eligibleConditionFields(moved, { kind: 'item', sectionId: 'family', itemId: 'children' }).map(f => f.id)).toEqual(['county'])
    expect(compileIntakeForm(moved, 'client')).toMatchObject({ success: false, errors: [{ path: 'sections.1.items.0.condition' }] })
  })

  it('routes nested diagnostics to the affected selection and control', () => {
    const definition = fixture()
    expect(targetForDiagnostic('sections.1.items.2.condition.value', definition))
      .toEqual({ kind: 'item', sectionId: 'family', itemId: 'guardian', control: 'condition' })
    expect(targetForDiagnostic('sections.1.title', definition)).toEqual({ kind: 'section', sectionId: 'family', control: 'title' })
    expect(targetForDiagnostic('title', definition)).toEqual({ kind: 'form', control: 'title' })
    expect(targetForDiagnostic('sections', definition)).toEqual({ kind: 'form', control: 'sections' })
    expect(targetForDiagnostic('sections.9.items.2', definition)).toEqual({ kind: 'form', control: 'definition' })
  })

  it('compares definitions independent of object key order while preserving content and list order', () => {
    const original = fixture()
    const reorderedKeys = { sections: original.sections, title: 'Estate', key: 'estate', schemaVersion: 1 as const }
    expect(definitionFingerprint(original)).toBe(definitionFingerprint(structuredClone(original)))
    expect(definitionFingerprint(original)).toBe(definitionFingerprint(reorderedKeys))
    expect(definitionFingerprint(updateSection(original, 'personal', { title: 'Changed' }))).not.toBe(definitionFingerprint(original))
    expect(definitionFingerprint(moveSection(original, 'family', 0))).not.toBe(definitionFingerprint(original))
    vi.stubGlobal('crypto', undefined)
    try { expect(definitionFingerprint(original)).toBe(definitionFingerprint(reorderedKeys)) }
    finally { vi.unstubAllGlobals() }
  })
})
