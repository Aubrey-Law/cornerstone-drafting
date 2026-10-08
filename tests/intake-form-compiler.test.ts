import { describe, expect, it } from 'vitest'
import { compileIntakeForm } from '@/lib/intake/forms/compiler'
import type { IntakeFormDefinition, IntakeFormItem } from '@/lib/intake/forms/types'

function form(items: IntakeFormItem[] = []): IntakeFormDefinition {
  return { schemaVersion: 1, key: 'test', title: 'Test', sections: [
    { id: 'personal', title: 'Personal', audience: 'client_and_staff', items },
    { id: 'review', title: 'Review', audience: 'client_and_staff', items: [{ kind: 'block', id: 'submit', blockId: 'review_submit' }] },
  ] }
}

describe('canonical form compiler', () => {
  it('resolves labels and immutable requirements into JSON without catalog functions', () => {
    const result = compileIntakeForm(form([{ kind: 'field', id: 'name', fieldId: 'client_first_name', labelOverride: 'Your name', helpText: 'Legal name' }]), 'client')
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.form.sections[0].items[0]).toMatchObject({ label: 'Your name', helpText: 'Legal name', effectiveRequirement: 'required' })
    expect(JSON.parse(JSON.stringify(result.form))).toEqual(result.form)
    expect(JSON.stringify(result.form)).not.toMatch(/intakeKey|designKey|normalize|read|write/)
  })

  it.each(['missing', 'client_name'])('rejects unavailable builder field %s', (fieldId) => {
    const raw = form([{ kind: 'field', id: 'field', fieldId: 'client_first_name' }])
    Object.assign(raw.sections[0].items[0], { fieldId })
    expect(compileIntakeForm(raw, 'client').success).toBe(false)
  })

  it('rejects unknown blocks and unsupported config keys', () => {
    const raw = form([{ kind: 'block', id: 'address', blockId: 'address', config: { intakeKey: 'secret' } }])
    expect(compileIntakeForm(raw, 'client')).toMatchObject({ success: false, errors: [{ path: 'sections.0.items.0.config', message: expect.any(String) }] })
    Object.assign(raw.sections[0].items[0], { blockId: 'missing' })
    expect(compileIntakeForm(raw, 'client').success).toBe(false)
  })

  it('rejects duplicate scalar use even with distinct item IDs', () => {
    expect(compileIntakeForm(form([
      { kind: 'field', id: 'one', fieldId: 'client_first_name' },
      { kind: 'field', id: 'two', fieldId: 'client_first_name' },
    ]), 'client').success).toBe(false)
  })

  it.each(['client_first_name', 'client_email'] as const)('rejects weakening %s', (fieldId) => {
    expect(compileIntakeForm(form([{ kind: 'field', id: 'field', fieldId, requirement: 'optional' }]), 'client').success).toBe(false)
  })

  it('rejects forward condition references', () => {
    expect(compileIntakeForm(form([
      { kind: 'field', id: 'child', fieldId: 'has_minor_children', condition: { op: 'equals', fieldId: 'has_children', value: true } },
      { kind: 'field', id: 'parent', fieldId: 'has_children' },
    ]), 'client').success).toBe(false)
  })

  it.each([
    { fieldId: 'has_children', value: 'yes' },
    { fieldId: 'marital_status', value: true },
    { fieldId: 'marital_status', value: 'not-an-option' },
  ] as const)('rejects mismatched condition $fieldId/$value', ({ fieldId, value }) => {
    expect(compileIntakeForm(form([
      { kind: 'field', id: 'source', fieldId },
      { kind: 'block', id: 'target', blockId: 'children', condition: { op: 'equals', fieldId, value } },
    ]), 'client').success).toBe(false)
  })

  it('removes staff-only content from client output', () => {
    const raw = form()
    raw.sections.splice(1, 0, { id: 'internal_signing', title: 'Internal', audience: 'staff_only', items: [{ kind: 'block', id: 'internal_plan', blockId: 'attorney_plan_structure' }] })
    const client = compileIntakeForm(raw, 'client')
    const staff = compileIntakeForm(raw, 'staff')
    expect(client.success).toBe(true)
    expect(staff.success).toBe(true)
    if (!client.success || !staff.success) return
    expect(client.form.sections.map((s) => s.id)).toEqual(['personal', 'review'])
    expect(JSON.stringify(client.form)).not.toContain('internal')
    expect(staff.form.sections.map((s) => s.id)).toEqual(['personal', 'internal_signing', 'review'])
  })

  it('rejects staff-only blocks in shared sections rather than delivering them', () => {
    expect(compileIntakeForm(form([{ kind: 'block', id: 'plan', blockId: 'attorney_plan_structure' }]), 'client').success).toBe(false)
  })

  it('rejects client conditions whose controlling field is stripped', () => {
    const raw = form([{ kind: 'block', id: 'child', blockId: 'children', condition: { op: 'equals', fieldId: 'has_children', value: true } }])
    raw.sections.unshift({ id: 'internal', title: 'Internal', audience: 'staff_only', items: [{ kind: 'field', id: 'control', fieldId: 'has_children' }] })
    expect(compileIntakeForm(raw, 'client').success).toBe(false)
  })

  it('requires an unconditional shared review and submit path', () => {
    const raw = form()
    raw.sections.pop()
    expect(compileIntakeForm(raw, 'client').success).toBe(false)
    raw.sections.push({ id: 'review', title: 'Review', audience: 'staff_only', items: [{ kind: 'block', id: 'submit', blockId: 'review_submit' }] })
    expect(compileIntakeForm(raw, 'client').success).toBe(false)
  })

  it('clones configuration and collects deterministic diagnostics', () => {
    const raw = form([{ kind: 'block', id: 'address', blockId: 'address', config: { profile: 'college' } }])
    const result = compileIntakeForm(raw, 'client')
    expect(result.success).toBe(true)
    if (!result.success) return
    Object.assign((raw.sections[0].items[0] as { config: object }).config, { profile: 'estate' })
    expect(result.form.sections[0].items[0]).toMatchObject({ config: { profile: 'college' } })
    const bad = form([
      { kind: 'field', id: 'one', fieldId: 'client_first_name', requirement: 'optional' },
      { kind: 'field', id: 'two', fieldId: 'client_first_name' },
    ])
    const errors = compileIntakeForm(bad, 'client')
    expect(errors).toMatchObject({ success: false })
    if (errors.success) return
    expect(errors.errors.map((e) => e.path)).toEqual(['sections.0.items.0.requirement', 'sections.0.items.1.fieldId'])
  })
})
