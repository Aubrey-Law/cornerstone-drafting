import { describe, expect, it } from 'vitest'
import type { SharedFieldId } from '@aubrey-law/estate-fields/core'
import { parseIntakeFormDefinition } from '@/lib/intake/forms/schema'
import { collectConditionFieldIds, evaluateIntakeCondition } from '@/lib/intake/forms/conditions'
import type { IntakeCondition } from '@/lib/intake/forms/types'

const field = () => ({ kind: 'field', id: 'client-email', fieldId: 'client_email' })
const section = () => ({ id: 'personal', title: 'Personal', audience: 'client_and_staff', items: [field()] })
const definition = () => ({ schemaVersion: 1, key: 'estate', title: 'Estate', sections: [section()] })
const equals: IntakeCondition = { op: 'equals', fieldId: 'marital_status', value: 'married' }

function rejected(raw: unknown, path: string) {
  const result = parseIntakeFormDefinition(raw)
  expect(result.success).toBe(false)
  if (result.success) return
  expect(result.errors.some((error) => error.startsWith(`${path}:`))).toBe(true)
  return result.errors.join('\n')
}

describe('intake form definition parsing', () => {
  it('accepts a minimal definition without mutating it', () => {
    const raw = Object.freeze({ schemaVersion: 1, key: 'estate', title: 'Estate', sections: [] })
    expect(parseIntakeFormDefinition(raw)).toEqual({ success: true, data: raw })
  })

  it('accepts serializable field and block options', () => {
    const raw = { ...definition(), description: 'Planning', sections: [{ ...section(), subtitle: 'About you', optional: true,
      timeEstimateMinutes: 3, condition: equals, items: [
        { ...field(), labelOverride: 'Email address', helpText: 'Contact email', requirement: 'recommended', condition: equals },
        { kind: 'block', id: 'spouse', blockId: 'spouse_details', titleOverride: 'Spouse', helpText: 'Details',
          config: { enabled: true, entries: [null, 2, { label: 'Name' }] }, condition: equals },
      ] }] }
    expect(parseIntakeFormDefinition(raw)).toEqual({ success: true, data: raw })
  })

  it('rejects executable and unknown definition content', () => {
    expect(rejected({ ...definition(), onLoad: 'alert(1)' }, 'definition')).toContain('onLoad')
  })

  it.each([
    ['section', { ...definition(), sections: [{ ...section(), onLoad: () => true }] }, 'sections.0'],
    ['field', { ...definition(), sections: [{ ...section(), items: [{ ...field(), callback: 'run' }] }] }, 'sections.0.items.0'],
    ['block', { ...definition(), sections: [{ ...section(), items: [{ kind: 'block', id: 'spouse', blockId: 'spouse_details', callback: 'run' }] }] }, 'sections.0.items.0'],
    ['condition', { ...definition(), sections: [{ ...section(), condition: { ...equals, callback: 'run' } }] }, 'sections.0.condition'],
  ])('rejects unknown keys on a %s', (_name, raw, path) => { rejected(raw, path) })

  it('rejects duplicate section IDs', () => {
    rejected({ ...definition(), sections: [section(), { ...section(), items: [] }] }, 'sections.1.id')
  })

  it('rejects duplicate item IDs across sections', () => {
    rejected({ ...definition(), sections: [section(), { ...section(), id: 'other' }] }, 'sections.1.items.0.id')
  })

  it.each(['', '   ', 'x'.repeat(81)])('rejects invalid IDs %j', (id) => {
    rejected({ ...definition(), key: id }, 'key')
    rejected({ ...definition(), sections: [{ ...section(), id }] }, 'sections.0.id')
    rejected({ ...definition(), sections: [{ ...section(), items: [{ ...field(), id }] }] }, 'sections.0.items.0.id')
  })

  it('rejects oversized titles, labels, subtitles, descriptions and help text', () => {
    rejected({ ...definition(), title: 'x'.repeat(161) }, 'title')
    rejected({ ...definition(), description: 'x'.repeat(601) }, 'description')
    rejected({ ...definition(), sections: [{ ...section(), title: 'x'.repeat(161) }] }, 'sections.0.title')
    rejected({ ...definition(), sections: [{ ...section(), subtitle: 'x'.repeat(601) }] }, 'sections.0.subtitle')
    rejected({ ...definition(), sections: [{ ...section(), items: [{ ...field(), labelOverride: 'x'.repeat(161) }] }] }, 'sections.0.items.0.labelOverride')
    rejected({ ...definition(), sections: [{ ...section(), items: [{ ...field(), helpText: 'x'.repeat(601) }] }] }, 'sections.0.items.0.helpText')
  })

  it('rejects unsupported versions, field IDs and block IDs', () => {
    rejected({ ...definition(), schemaVersion: 2 }, 'schemaVersion')
    rejected({ ...definition(), sections: [{ ...section(), items: [{ ...field(), fieldId: 'missing' }] }] }, 'sections.0.items.0.fieldId')
    rejected({ ...definition(), sections: [{ ...section(), items: [{ kind: 'block', id: 'bad', blockId: 'missing' }] }] }, 'sections.0.items.0.blockId')
  })

  it.each([42, null, [], {}, () => true])('rejects non-string/non-boolean condition values %j', (value) => {
    rejected({ ...definition(), sections: [{ ...section(), condition: { ...equals, value } }] }, 'sections.0.condition.value')
  })

  it.each(['all', 'any'])('rejects empty %s conditions', (op) => {
    rejected({ ...definition(), sections: [{ ...section(), condition: { op, conditions: [] } }] }, 'sections.0.condition.conditions')
  })

  it('rejects a condition referring to its own field even with a different item ID', () => {
    rejected({ ...definition(), sections: [{ ...section(), items: [{ ...field(), condition: { op: 'is_set', fieldId: 'client_email' } }] }] }, 'sections.0.items.0.condition')
  })

  it('rejects nested self references', () => {
    rejected({ ...definition(), sections: [{ ...section(), items: [{ ...field(), condition: { op: 'any', conditions: [equals, { op: 'is_set', fieldId: 'client_email' }] } }] }] }, 'sections.0.items.0.condition')
  })

  it('accepts five condition levels and rejects six', () => {
    let condition: IntakeCondition = equals
    for (let level = 1; level < 5; level++) condition = { op: 'all', conditions: [condition] }
    expect(parseIntakeFormDefinition({ ...definition(), sections: [{ ...section(), condition }] }).success).toBe(true)
    condition = { op: 'any', conditions: [condition] }
    expect(parseIntakeFormDefinition({ ...definition(), sections: [{ ...section(), condition }] }).success).toBe(false)
  })

  it('enforces section and item count limits', () => {
    const sections = Array.from({ length: 40 }, (_, i) => ({ ...section(), id: `s${i}`, items: [] }))
    expect(parseIntakeFormDefinition({ ...definition(), sections }).success).toBe(true)
    rejected({ ...definition(), sections: [...sections, { ...section(), id: 'extra' }] }, 'sections')
    const items = Array.from({ length: 100 }, (_, i) => ({ ...field(), id: `f${i}` }))
    expect(parseIntakeFormDefinition({ ...definition(), sections: [{ ...section(), items }] }).success).toBe(true)
    rejected({ ...definition(), sections: [{ ...section(), items: [...items, { ...field(), id: 'extra' }] }] }, 'sections.0.items')
  })

  it.each([() => true, undefined, Number.NaN, Number.POSITIVE_INFINITY, new Date(), BigInt(1)])('rejects non-JSON block config values %#', (value) => {
    expect(parseIntakeFormDefinition({ ...definition(), sections: [{ ...section(), items: [{ kind: 'block', id: 'spouse', blockId: 'spouse_details', config: { nested: { value } } }] }] }).success).toBe(false)
  })

  it('rejects cyclic config instead of throwing', () => {
    const config: Record<string, unknown> = {}
    config.self = config
    expect(parseIntakeFormDefinition({ ...definition(), sections: [{ ...section(), items: [{ kind: 'block', id: 'spouse', blockId: 'spouse_details', config }] }] }).success).toBe(false)
  })

  it('rejects a root config accessor without invoking its throwing getter', () => {
    let getterCalls = 0
    const config = Object.defineProperty({}, 'enabled', {
      enumerable: true,
      get() {
        getterCalls++
        throw new Error('Config getter must not execute')
      },
    })
    rejected({ ...definition(), sections: [{ ...section(), items: [{ kind: 'block', id: 'spouse', blockId: 'spouse_details', config }] }] }, 'sections.0.items.0.config')
    expect(getterCalls).toBe(0)
  })

  it('rejects a class instance at the config root', () => {
    class Config {
      enabled = true
    }
    rejected({ ...definition(), sections: [{ ...section(), items: [{ kind: 'block', id: 'spouse', blockId: 'spouse_details', config: new Config() }] }] }, 'sections.0.items.0.config')
  })
})

describe('intake conditions', () => {
  it('defaults to visible without a condition', () => {
    expect(evaluateIntakeCondition(undefined, () => undefined)).toBe(true)
  })

  it('uses the supplied field resolver and exact equality', () => {
    const row = { stored_status: 'married' }
    const resolve = (id: import('@/lib/discovery/catalog').FormFieldId) => id === 'marital_status' ? row.stored_status : undefined
    expect(evaluateIntakeCondition(equals, resolve)).toBe(true)
    expect(evaluateIntakeCondition({ ...equals, op: 'not_equals' }, resolve)).toBe(false)
    expect(evaluateIntakeCondition(equals, () => 'single')).toBe(false)
    expect(evaluateIntakeCondition({ op: 'equals', fieldId: 'client_email', value: true }, () => true)).toBe(true)
    expect(evaluateIntakeCondition({ op: 'equals', fieldId: 'client_email', value: true }, () => 'true')).toBe(false)
  })

  it.each([
    [undefined, false], [null, false], ['', false], ['  ', false], [[], false],
    ['Jane', true], [[null], true], [false, true], [0, true],
  ])('is_set evaluates %j as %j', (value, expected) => {
    expect(evaluateIntakeCondition({ op: 'is_set', fieldId: 'client_email' }, () => value)).toBe(expected)
  })

  it('evaluates nested all and any branches', () => {
    const condition: IntakeCondition = { op: 'all', conditions: [equals, { op: 'any', conditions: [
      { op: 'equals', fieldId: 'client_email', value: 'jane@example.com' }, { op: 'is_set', fieldId: 'client_phone' },
    ] }] }
    expect(evaluateIntakeCondition(condition, (id) => id === 'marital_status' ? 'married' : id === 'client_phone' ? '555' : undefined)).toBe(true)
    expect(evaluateIntakeCondition(condition, (id) => id === 'marital_status' ? 'married' : undefined)).toBe(false)
  })

  it('collects unique referenced fields in traversal order', () => {
    expect(collectConditionFieldIds(undefined)).toEqual([])
    expect(collectConditionFieldIds({ op: 'any', conditions: [equals, { op: 'all', conditions: [
      { op: 'is_set', fieldId: 'client_email' }, equals, { op: 'not_equals', fieldId: 'client_phone', value: '' },
    ] }] })).toEqual(['marital_status', 'client_email', 'client_phone'])
  })

  it('retains existing spouse data when hidden', () => {
    const row = Object.freeze({ marital_status: 'married', _spouse: Object.freeze({ first_name: 'Alex' }) })
    expect(evaluateIntakeCondition(equals, (id) => id === 'marital_status' ? row.marital_status : undefined)).toBe(true)
    expect(evaluateIntakeCondition(equals, (id) => id === 'marital_status' ? 'single' : undefined)).toBe(false)
    expect(row).toEqual({ marital_status: 'married', _spouse: { first_name: 'Alex' } })
  })
})
