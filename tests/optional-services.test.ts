import { describe, expect, it } from 'vitest'
import { optionalServicesForProposal, parseOptionalServices } from '@/lib/billing/optionalServices'

describe('parseOptionalServices', () => {
  it('keeps "nothing recorded" and "none offered" apart', () => {
    expect(parseOptionalServices(null)).toBeNull()
    expect(parseOptionalServices(undefined)).toBeNull()
    expect(parseOptionalServices([])).toEqual([])
  })

  it('drops blank rows and reads fees written as money', () => {
    expect(parseOptionalServices([
      { service: '  Real Property Transfer ', description: 'Deed', fee: '$1,350', status: 'Recommended' },
      { service: '', description: 'left behind by the editor', fee: 10, status: 'Optional' },
      { service: 'Supervised signing', fee: 'tbd', status: 'whenever' },
    ])).toEqual([
      { service: 'Real Property Transfer', description: 'Deed', fee: 1350, status: 'Recommended' },
      { service: 'Supervised signing', description: '', fee: null, status: 'Optional' },
    ])
  })
})

describe('optionalServicesForProposal', () => {
  it('prints a missing fee as something to confirm, never as zero', () => {
    expect(optionalServicesForProposal([{ service: 'Deed', description: '', fee: null, status: 'Optional' }]))
      .toEqual([{ name: 'Deed', description: '', fee: '[confirm]', status: 'Optional' }])
  })
})
