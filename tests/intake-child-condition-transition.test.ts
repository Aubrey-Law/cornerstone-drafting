import { expect, it } from 'vitest'
import { writeBuilderFieldValue } from '@aubrey-law/estate-fields/core'
import { evaluateBundledIntakeForm } from '@/lib/intake/forms/definitions'

it('hides guardian validation when the canonical children answer changes to No, retaining hidden answers for re-show', () => {
  let data: Record<string, unknown> = { has_children: true, has_minor_children: true, _children: [{ first_name: 'Sam', last_name: 'Example' }], _fid_guardian_client: [] }
  const children = data._children
  const evaluate = () => evaluateBundledIntakeForm('estate', 'client', data)
  expect(evaluate().activeSections.find((section) => section.id === 'guardian')?.issues.length).toBeGreaterThan(0)
  writeBuilderFieldValue('has_children', false, (key, value) => { data = { ...data, [key]: value } })
  expect(evaluate().activeSections.map((section) => section.id)).not.toContain('guardian')
  expect(evaluate().activeSections.map((section) => section.id)).not.toContain('children')
  expect(evaluate().requiredSections.map((section) => section.id)).not.toContain('guardian')
  expect(data.has_minor_children).toBe(true)
  expect(data._children).toBe(children)
  expect(data._fid_guardian_client).toEqual([])
  writeBuilderFieldValue('has_children', true, (key, value) => { data = { ...data, [key]: value } })
  expect(evaluate().activeSections.find((section) => section.id === 'guardian')?.issues.length).toBeGreaterThan(0)
  expect(data._children).toBe(children)
})
