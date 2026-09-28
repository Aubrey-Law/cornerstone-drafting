import { describe, expect, it } from 'vitest'
import { unitsFor } from '@/lib/runs/context'

describe('the units a run still has to do', () => {
  it('is every unit of the body, filtered to the ones asked for', () => {
    const body = { kind: 'field_audit' as const, inputs: [], checks: [
      { number: '1' }, { number: '2' }, { number: '3' },
    ] } as never
    expect(unitsFor(body, ['2', '3']).map((u: { number: string }) => u.number)).toEqual(['2', '3'])
  })

  it('is the whole body when nothing is named', () => {
    // A first run has no filter: every unit is still to do.
    const body = { kind: 'review' as const, inputs: [], rules: [
      { number: '1' }, { number: '2' },
    ] } as never
    expect(unitsFor(body, null)).toHaveLength(2)
  })

  it('keeps the body’s own order, not the order asked for', () => {
    // A playbook's order is the order its author meant, and the prompt cache
    // depends on the document sitting ahead of a varying unit — reordering
    // would not break correctness but it would make a run read wrongly.
    const body = { kind: 'field_audit' as const, inputs: [], checks: [
      { number: '1' }, { number: '2' }, { number: '3' },
    ] } as never
    expect(unitsFor(body, ['3', '1']).map((u: { number: string }) => u.number)).toEqual(['1', '3'])
  })
})
