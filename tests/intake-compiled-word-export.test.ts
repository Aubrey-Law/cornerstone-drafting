import { describe, expect, it } from 'vitest'
import { Packer } from 'docx'
import PizZip from 'pizzip'
import { compileIntakeForm } from '@/lib/intake/forms/compiler'
import { buildCompiledIntakeExportSections } from '@/lib/intake/forms/wordExport'
import { buildIntakeWordDocument } from '@/lib/intake/wordExport'
import type { IntakeBlockId, IntakeFormDefinition, IntakeFormItem } from '@/lib/intake/forms/types'

function compiled(items: IntakeFormItem[], staff = false) {
  const definition: IntakeFormDefinition = { schemaVersion: 1, key: 'custom', title: 'Custom questionnaire', sections: [
    { id: 'answers', title: 'My questions', audience: staff ? 'staff_only' : 'client_and_staff', items },
    { id: 'review', title: 'Review', audience: 'client_and_staff', items: [{ kind: 'block', id: 'submit', blockId: 'review_submit' }] },
  ] }
  const result = compileIntakeForm(definition, staff ? 'staff' : 'client')
  if (!result.success) throw new Error(JSON.stringify(result.errors))
  return result.form
}
const blocks: IntakeBlockId[] = ['address', 'spouse_details', 'children', 'financial_assets', 'planning_objectives', 'existing_document_uploads', 'additional_contacts', 'client_fiduciaries', 'spouse_fiduciaries', 'guardian', 'college_parents', 'college_agents', 'college_hipaa_recipients', 'attorney_plan_structure', 'attorney_documents']
describe('compiled questionnaire Word export', () => {
  it('preserves mixed item order and overrides in the actual Word file, omitting hidden answers and review recursion', async () => {
    const form = compiled([
      { kind: 'field', id: 'name', fieldId: 'client_first_name', labelOverride: 'Custom first label' },
      { kind: 'block', id: 'address', blockId: 'address', titleOverride: 'Custom home', config: { includeCounty: false } },
      { kind: 'field', id: 'married', fieldId: 'marital_status' },
      { kind: 'block', id: 'spouse', blockId: 'spouse_details', condition: { fieldId: 'marital_status', op: 'equals', value: 'married' } },
      { kind: 'field', id: 'last', fieldId: 'client_last_name', labelOverride: 'Custom final label' },
    ])
    const sections = buildCompiledIntakeExportSections(form, { first_name: 'Avery', last_name: 'Jones', street_address: '12 Elm Street', marital_status: 'single', county: 'SECRET COUNTY', _spouse: { first_name: 'SECRET SPOUSE' } })
    const doc = buildIntakeWordDocument(sections, { clientName: 'Avery Jones', practiceArea: 'Estate', intakeTrack: 'estate', status: null, exportedOn: '2026-10-09', documentTitle: form.title })
    const xml = new PizZip(await Packer.toBuffer(doc)).file('word/document.xml')!.asText()
    const positions = ['My questions', 'Custom first label', 'Custom home', '12 Elm Street', 'Custom final label'].map(s => xml.indexOf(s))
    expect(positions.every(p => p >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    expect(xml).not.toContain('SECRET')
    expect(sections).toHaveLength(1)
  })
  it.each(blocks)('supports %s without dumping unrelated stored metadata', blockId => {
    const form = compiled([{ kind: 'block', id: 'block', blockId }], blockId.startsWith('attorney_'))
    const sections = buildCompiledIntakeExportSections(form, { internal_secret: 'SECRET', invite_token: 'TOKEN' })
    expect(sections).toHaveLength(1)
    expect(JSON.stringify(sections)).not.toMatch(/SECRET|TOKEN/)
  })
  it('reads nested financial details and excludes stale details for unselected assets', () => {
    const form = compiled([{ kind: 'block', id: 'assets', blockId: 'financial_assets' }])
    const sections = buildCompiledIntakeExportSections(form, { financial_details: { asset_types: ['real_estate'], real_estate: [{ address: '12 Elm St', value: '$500,000', id: 'PRIVATE ID' }], bank_accounts: { client_total: 'STALE VALUE' } } })
    expect(JSON.stringify(sections)).toContain('$500,000')
    expect(JSON.stringify(sections)).not.toMatch(/PRIVATE ID|STALE VALUE/)
  })
  it('uses hydrated contacts over embedded snapshots and decodes nested college answers', () => {
    const form = compiled([{ kind: 'block', id: 'parents', blockId: 'college_parents' }, { kind: 'block', id: 'hipaa', blockId: 'college_hipaa_recipients' }])
    const sections = buildCompiledIntakeExportSections(form, { fiduciary_entries: { additional_contacts: [{ first_name: 'STALE' }] }, _additional_contacts: [{ first_name: 'Current', email: 'current@example.test' }], college_prep_details: { hipaa_recipients: [{ name: 'Authorized recipient', phone: '6175550100' }] } })
    expect(JSON.stringify(sections)).not.toContain('STALE')
    expect(JSON.stringify(sections)).toContain('current@example.test')
    expect(JSON.stringify(sections)).toContain('Authorized recipient')
  })
  it('formats dates, false, and catalog options while preserving blank answers', () => {
    const form = compiled([{ kind: 'field', id: 'dob', fieldId: 'client_dob' }, { kind: 'field', id: 'children', fieldId: 'has_children' }, { kind: 'field', id: 'marital', fieldId: 'marital_status' }, { kind: 'field', id: 'name', fieldId: 'client_first_name' }])
    const rows = buildCompiledIntakeExportSections(form, { date_of_birth: '2000-01-02', has_children: false, marital_status: 'single' })[0].parts![0].rows
    expect(rows.map(row => row.value)).toEqual(['Jan 2, 2000', 'No', 'Single', '—'])
  })
  it('preserves saved spouse aliases and fiduciary contacts, priorities, and discussion choices', () => {
    const form = compiled([{ kind: 'block', id: 'spouse', blockId: 'spouse_details' }, { kind: 'block', id: 'fiduciaries', blockId: 'client_fiduciaries' }])
    const sections = buildCompiledIntakeExportSections(form, {
      _spouse: { first_name: 'Morgan', prior_names: 'Former surname', is_us_citizen: false },
      review_choices: { fiduciaries: 'discuss_with_attorney' },
      fiduciary_entries: { fid_trustee_client: [{ first_name: 'Taylor', last_name: 'Smith', phone: '6175550100', priority: 2, is_coagent: true }] },
    })
    const text = JSON.stringify(sections)
    for (const value of ['Morgan', 'Former surname', 'Discuss with attorney', 'Taylor', '6175550100', 'Priority', 'Co-agent']) expect(text).toContain(value)
    expect(text.indexOf('Successor trustee')).toBeLessThan(text.indexOf('Personal representative'))
  })
  it('does not print a conditional section merely because stale answers remain saved', () => {
    const result = compileIntakeForm({ schemaVersion: 1, key: 'conditional', title: 'Conditional questionnaire', sections: [
      { id: 'family', title: 'Family', audience: 'client_and_staff', items: [{ kind: 'field', id: 'children', fieldId: 'has_children' }] },
      { id: 'child_details', title: 'Hidden section', audience: 'client_and_staff', condition: { fieldId: 'has_children', op: 'equals', value: true }, items: [{ kind: 'block', id: 'details', blockId: 'children' }] },
      { id: 'review', title: 'Review', audience: 'client_and_staff', items: [{ kind: 'block', id: 'submit', blockId: 'review_submit' }] },
    ] }, 'client')
    if (!result.success) throw new Error(JSON.stringify(result.errors))
    const sections = buildCompiledIntakeExportSections(result.form, { has_children: false, _children: [{ first_name: 'HIDDEN ANSWER' }] })
    expect(sections.map(section => section.title)).toEqual(['Family'])
    expect(JSON.stringify(sections)).not.toContain('HIDDEN')
  })
})
