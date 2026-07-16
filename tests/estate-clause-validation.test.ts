import { describe, expect, it } from 'vitest'
import {
  assertNoClauseCycles,
  hashEstateClauseContent,
  validateEstateClauseContent,
} from '@/lib/estateClauses/validation'
import type { EstateClauseContent } from '@/lib/estateClauses/types'

const clause: EstateClauseContent = {
  text: 'I appoint {{ fiduciaries.agent.primary.full_name | name }}.',
  requiredFields: ['fiduciaries.agent.primary.full_name'],
  nestedClauseKeys: [],
}

describe('estate clause validation', () => {
  it('accepts declared fields and supported filters', () => {
    expect(validateEstateClauseContent({
      ...clause,
      text: [
        '{{ fiduciaries.agent.primary.full_name | name }}',
        '{{ fiduciaries.agent.primary.full_name | NAME }}',
        '{{ fiduciaries.agent.primary.full_name | orMissing("primary agent") }}',
        '{{ fiduciaries.agent.primary.full_name | optional }}',
      ].join(' '),
    }, new Set())).toEqual([])
  })

  it('produces a stable canonical hash', () => {
    const reordered: EstateClauseContent = {
      text: `${clause.text}\r\nSecond paragraph.`,
      requiredFields: [
        'fiduciaries.agent.successor.full_name',
        'fiduciaries.agent.primary.full_name',
        'fiduciaries.agent.primary.full_name',
      ],
      nestedClauseKeys: ['poa.signing', 'poa.powers', 'poa.signing'],
      conditionField: null,
    }
    const canonical: EstateClauseContent = {
      text: `${clause.text}\nSecond paragraph.`,
      requiredFields: [
        'fiduciaries.agent.primary.full_name',
        'fiduciaries.agent.successor.full_name',
      ],
      nestedClauseKeys: ['poa.powers', 'poa.signing'],
    }

    expect(hashEstateClauseContent(reordered)).toBe(hashEstateClauseContent(canonical))
    expect(hashEstateClauseContent(canonical)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rejects undeclared fields and unsupported template syntax', () => {
    const errors = validateEstateClauseContent({
      ...clause,
      text: '{{ client.secret }} {{ fiduciaries.agent.primary.full_name | escape }} {% for x in y %}',
    }, new Set())

    expect(errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/client\.secret/),
      expect.stringMatching(/escape/),
      expect.stringMatching(/for/),
    ]))
  })

  it('rejects malformed and non-variable output expressions', () => {
    expect(validateEstateClauseContent({
      ...clause,
      text: '{{ fiduciaries.agent.primary.full_name + "suffix" }} {{ incomplete',
    }, new Set())).toEqual(expect.arrayContaining([
      expect.stringMatching(/unsupported.*expression/i),
      expect.stringMatching(/malformed.*template/i),
    ]))
  })

  it('rejects template comments from the restricted syntax', () => {
    expect(validateEstateClauseContent({
      ...clause,
      text: '{{ fiduciaries.agent.primary.full_name }} {# hidden instruction #}',
    }, new Set())).toContain('Unsupported template comment: hidden instruction')
  })

  it('rejects duplicate required fields', () => {
    expect(validateEstateClauseContent({
      ...clause,
      requiredFields: [
        'fiduciaries.agent.primary.full_name',
        'fiduciaries.agent.primary.full_name',
      ],
    }, new Set())).toContain('Duplicate required field: fiduciaries.agent.primary.full_name')
  })

  it('requires nested includes and declarations to be known and consistent', () => {
    const catalog = new Set(['poa.known'])

    expect(validateEstateClauseContent({
      ...clause,
      text: '{{ fiduciaries.agent.primary.full_name | name }} {{ include_clause("poa.missing") }}',
      nestedClauseKeys: ['poa.known', 'poa.missing', 'poa.unused'],
    }, catalog)).toEqual(expect.arrayContaining([
      'Unknown nested clause key: poa.missing',
      'Unknown nested clause key: poa.unused',
      'Nested clause key is declared but not included: poa.known',
      'Nested clause key is declared but not included: poa.unused',
    ]))
  })

  it('accepts a literal include declared in the catalog', () => {
    expect(validateEstateClauseContent({
      ...clause,
      text: '{{ include_clause("poa.powers") }}',
      nestedClauseKeys: ['poa.powers'],
    }, new Set(['poa.powers']))).toEqual([])
  })

  it('rejects nested cycles with a deterministic path', () => {
    expect(() => assertNoClauseCycles(new Map([
      ['b', ['c', 'a']],
      ['c', ['b']],
      ['a', ['b']],
    ]))).toThrow(/cycle: a -> b -> a/i)
  })

  it('accepts an acyclic catalog', () => {
    expect(() => assertNoClauseCycles(new Map([
      ['a', ['b']],
      ['b', ['c']],
      ['c', []],
    ]))).not.toThrow()
  })
})
