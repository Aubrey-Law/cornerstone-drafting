import { describe, expect, it } from 'vitest'
import { searchPlan } from '../reviewActions'

describe('searchPlan', () => {
  it('searches a short quote whole', () => {
    expect(searchPlan('The Trustee shall serve without bond.')).toEqual({ kind: 'whole', text: 'The Trustee shall serve without bond.' })
  })

  it('finds a quote past the 255-character limit by its two ends', () => {
    const quote = `${'a'.repeat(150)} middle ${'b'.repeat(150)}`
    const plan = searchPlan(quote)
    expect(plan.kind).toBe('edges')
    if (plan.kind !== 'edges') return
    expect(plan.head.length).toBeLessThanOrEqual(255)
    expect(plan.tail.length).toBeLessThanOrEqual(255)
    expect(quote.startsWith(plan.head)).toBe(true)
    expect(quote.endsWith(plan.tail)).toBe(true)
  })

  it('refuses what Word search cannot look for', () => {
    expect(searchPlan('clause ^13')).toEqual({ kind: 'unsearchable' })
    expect(searchPlan('one\ntwo')).toEqual({ kind: 'unsearchable' })
    expect(searchPlan('   ')).toEqual({ kind: 'unsearchable' })
  })
})
