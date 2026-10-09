import { describe, expect, it } from 'vitest'
import { clonePreviewScenarioAnswers, INTAKE_PREVIEW_SCENARIOS } from '@/lib/intake/forms/previewScenarios'

describe('synthetic preview scenarios', () => {
  it('provides the controlling facts for empty, single, married, and family paths', () => {
    expect(clonePreviewScenarioAnswers('empty')).toEqual({})
    expect(clonePreviewScenarioAnswers('single')).toEqual({ first_name: 'Jordan', last_name: 'Lee', marital_status: 'single', has_children: false })
    expect(clonePreviewScenarioAnswers('married')).toEqual({ first_name: 'Jordan', last_name: 'Lee', marital_status: 'married', has_children: false,
      _spouse: { first_name: 'Morgan', last_name: 'Lee' } })
    expect(clonePreviewScenarioAnswers('family')).toEqual({ first_name: 'Jordan', last_name: 'Lee', marital_status: 'married', has_children: true,
      has_minor_children: true, _spouse: { first_name: 'Morgan', last_name: 'Lee' },
      _children: [{ first_name: 'Riley', last_name: 'Lee', relationship_type: 'Child' }] })
  })

  it('returns deep mutable clones so changing scenarios cannot carry edits forward', () => {
    const first = clonePreviewScenarioAnswers('family')
    first.first_name = 'Changed'
    ;(first._spouse as Record<string, unknown>).first_name = 'Changed spouse'
    ;(first._children as Record<string, unknown>[])[0].first_name = 'Changed child'
    ;(first._children as Record<string, unknown>[]).push({ first_name: 'Another child' })
    clonePreviewScenarioAnswers('single')
    const next = clonePreviewScenarioAnswers('family')
    expect(next.first_name).toBe('Jordan')
    expect(next._spouse).toEqual({ first_name: 'Morgan', last_name: 'Lee' })
    expect(next._children).toEqual([{ first_name: 'Riley', last_name: 'Lee', relationship_type: 'Child' }])
    expect(next).not.toBe(INTAKE_PREVIEW_SCENARIOS.family.answers)
  })

  it('deep freezes every constant object and array', () => {
    function assertFrozen(value: unknown): void {
      if (!value || typeof value !== 'object') return
      expect(Object.isFrozen(value)).toBe(true)
      Object.values(value).forEach(assertFrozen)
    }
    assertFrozen(INTAKE_PREVIEW_SCENARIOS)
    expect(Reflect.set(INTAKE_PREVIEW_SCENARIOS.family.answers._spouse, 'first_name', 'Changed')).toBe(false)
    expect(INTAKE_PREVIEW_SCENARIOS.family.answers._spouse.first_name).toBe('Morgan')
  })
})
