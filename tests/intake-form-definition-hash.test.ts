import { describe, expect, it } from 'vitest'
import { ESTATE_INTAKE_FORM } from '@/lib/intake/forms/definitions/estate'
import { canonicalizeIntakeFormDefinition, hashIntakeFormDefinition } from '@/lib/intake/forms/hash'

const definition = () => ({
  schemaVersion: 1, key: 'estate', title: 'Estate', sections: [{
    id: 'review', title: 'Review', audience: 'client_and_staff', items: [{
      kind: 'block', id: 'submit', blockId: 'review_submit',
      config: { z: { b: 2, a: 1 }, a: [true, null, { z: 'last', a: 'first' }] },
    }],
  }],
})

function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseKeys(child)]))
  }
  return value
}

describe('intake form definition hashing', () => {
  it('parses and recursively canonicalizes a fresh copy without mutating input', () => {
    const raw = definition()
    const original = JSON.stringify(raw)
    const canonical = canonicalizeIntakeFormDefinition(raw)
    expect(canonical).toEqual(raw)
    expect(canonical).not.toBe(raw)
    expect(Object.keys(canonical)).toEqual(['key', 'schemaVersion', 'sections', 'title'])
    const item = canonical.sections[0].items[0]
    if (item.kind !== 'block') throw new Error('Expected block')
    expect(Object.keys(item.config!)).toEqual(['a', 'z'])
    expect(Object.keys(item.config!.z as object)).toEqual(['a', 'b'])
    expect(JSON.stringify(raw)).toBe(original)
  })

  it('emits a lowercase SHA-256 digest', () => {
    expect(hashIntakeFormDefinition(ESTATE_INTAKE_FORM)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('ignores object insertion order throughout definitions and nested config', () => {
    for (const raw of [definition(), ESTATE_INTAKE_FORM]) {
      expect(hashIntakeFormDefinition(reverseKeys(raw))).toBe(hashIntakeFormDefinition(raw))
    }
  })

  it('changes the digest when presentation content changes', () => {
    expect(hashIntakeFormDefinition({ ...ESTATE_INTAKE_FORM, title: 'Changed' }))
      .not.toBe(hashIntakeFormDefinition(ESTATE_INTAKE_FORM))
  })

  it('preserves array order including nested config arrays', () => {
    const raw = definition()
    const changed = definition()
    changed.sections[0].items[0].config.a.reverse()
    expect(hashIntakeFormDefinition(changed)).not.toBe(hashIntakeFormDefinition(raw))
    expect(canonicalizeIntakeFormDefinition(raw).sections).toEqual(raw.sections)
    expect(hashIntakeFormDefinition({ ...ESTATE_INTAKE_FORM, sections: [...ESTATE_INTAKE_FORM.sections].reverse() }))
      .not.toBe(hashIntakeFormDefinition(ESTATE_INTAKE_FORM))
  })

  it.each([{ schemaVersion: 1 }, { ...definition(), script: 'run' }, { ...definition(), schemaVersion: 2 }])(
    'rejects invalid schema content %#', (raw) => {
      expect(() => canonicalizeIntakeFormDefinition(raw)).toThrow('Invalid intake form definition')
      expect(() => hashIntakeFormDefinition(raw)).toThrow('Invalid intake form definition')
    },
  )

  it.each([undefined, () => true, BigInt(1), Symbol('value'), NaN, Infinity, new Date(), new Map()])(
    'rejects non-JSON config values %#', (value) => {
      const raw = definition()
      Object.assign(raw.sections[0].items[0].config, { unsupported: value })
      expect(() => hashIntakeFormDefinition(raw)).toThrow('Invalid intake form definition')
    },
  )

  it('rejects cyclic config', () => {
    const raw = definition()
    Object.assign(raw.sections[0].items[0].config, { self: raw })
    expect(() => hashIntakeFormDefinition(raw)).toThrow('Invalid intake form definition')
  })

  it('rejects root and config accessors without evaluating getters', () => {
    let calls = 0
    const getter = { enumerable: true, get() { calls++; throw new Error('Must not execute') } }
    const root = Object.defineProperty(definition(), 'title', getter)
    const nested = definition()
    Object.defineProperty(nested.sections[0].items[0].config, 'computed', getter)
    for (const raw of [root, nested]) expect(() => hashIntakeFormDefinition(raw)).toThrow('Invalid intake form definition')
    expect(calls).toBe(0)
  })

  it('rejects class instances, symbol keys, hidden properties and sparse or decorated arrays', () => {
    class Form { schemaVersion = 1; key = 'estate'; title = 'Estate'; sections = [] }
    const symbolKey = Object.assign(definition(), { [Symbol('hidden')]: true })
    const hidden = Object.defineProperty(definition(), 'hidden', { value: true })
    const sparse = definition()
    sparse.sections[0].items[0].config.a = Array(2)
    const decorated = definition()
    Object.assign(decorated.sections, { extra: true })
    for (const raw of [new Form(), symbolKey, hidden, sparse, decorated]) {
      expect(() => hashIntakeFormDefinition(raw)).toThrow('Invalid intake form definition')
    }
  })

  it('rejects array subclasses rather than silently stripping their prototype', () => {
    class Sections extends Array {}
    expect(() => hashIntakeFormDefinition({ ...definition(), sections: new Sections() }))
      .toThrow('Invalid intake form definition')
  })
})
