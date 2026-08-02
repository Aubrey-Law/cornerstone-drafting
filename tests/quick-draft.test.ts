import { describe, expect, it } from 'vitest'
import { applyFieldOverrides, describeField, isOverridablePath } from '@/lib/drafting/quickDraft'
import { buildNodeEstateContext } from '@/lib/estateGenerator/node/context'

describe('isOverridablePath', () => {
  it('accepts known data roots and extras', () => {
    expect(isOverridablePath('client.full_name')).toBe(true)
    expect(isOverridablePath('trust.name')).toBe(true)
    expect(isOverridablePath('children.0.full_name')).toBe(true)
    expect(isOverridablePath('extras.my_custom_field')).toBe(true)
  })

  it('rejects derived context roots and unknown roots', () => {
    expect(isOverridablePath('state.code')).toBe(false)
    expect(isOverridablePath('has_spouse')).toBe(false)
    expect(isOverridablePath('unknown_root.value')).toBe(false)
  })

  it('rejects prototype-pollution and unsafe segments', () => {
    expect(isOverridablePath('client.__proto__.polluted')).toBe(false)
    expect(isOverridablePath('client.constructor')).toBe(false)
    expect(isOverridablePath('client.prototype.x')).toBe(false)
    expect(isOverridablePath('client.full name')).toBe(false)
    expect(isOverridablePath('')).toBe(false)
  })
})

describe('applyFieldOverrides', () => {
  it('sets nested dot-path values, creating intermediate objects', () => {
    const result = applyFieldOverrides({}, {
      'client.full_name': 'Jane Example',
      'trust.name': 'The Example Family Trust',
    })
    expect(result).toMatchObject({
      client: { full_name: 'Jane Example' },
      trust: { name: 'The Example Family Trust' },
    })
  })

  it('preserves sibling values and does not mutate the input', () => {
    const data = { client: { full_name: 'Old Name', county: 'Middlesex' } }
    const result = applyFieldOverrides(data, { 'client.full_name': 'New Name' })
    expect(result.client).toMatchObject({ full_name: 'New Name', county: 'Middlesex' })
    expect(data.client.full_name).toBe('Old Name')
  })

  it('indexes into arrays with numeric segments', () => {
    const data = { children: [{ full_name: 'Kid One' }, { full_name: 'Kid Two' }] }
    const result = applyFieldOverrides(data, { 'children.1.full_name': 'Renamed Kid' })
    const children = result.children as Array<{ full_name: string }>
    expect(children[0].full_name).toBe('Kid One')
    expect(children[1].full_name).toBe('Renamed Kid')
  })

  it('throws on non-overridable paths', () => {
    expect(() => applyFieldOverrides({}, { 'state.code': 'NY' })).toThrow(/not overridable/)
    expect(() => applyFieldOverrides({}, { 'client.__proto__.x': 'bad' })).toThrow(/not overridable/)
  })
})

describe('describeField', () => {
  it('returns label, type, and description from the data dictionary', () => {
    const info = describeField('client.county')
    expect(info.path).toBe('client.county')
    expect(info.label).toBe('Client — County')
    expect(info.type).toBe('string')
    expect(info.description).toBeTruthy()
  })

  it('normalizes numeric indices to the dictionary [] notation', () => {
    const info = describeField('children.0.full_name')
    expect(info.description).toBeTruthy()
  })

  it('falls back to a humanized label for unknown paths', () => {
    const info = describeField('extras.closing_paragraph')
    expect(info.label).toBe('Extras — Closing Paragraph')
    expect(info.type).toBe('string')
    expect(info.description).toBeNull()
  })
})

describe('extras passthrough into the render context', () => {
  it('exposes extras.* verbatim in the Nunjucks context', () => {
    const context = buildNodeEstateContext({
      data: { extras: { firm_motto: 'Plan well.' } },
      state: 'MA',
    })
    expect((context.extras as Record<string, string>).firm_motto).toBe('Plan well.')
  })
})
