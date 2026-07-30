import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  buildStaggeredTiersFromPreset,
  buildTrustNameSuggestions,
  getTrustDetails,
  STAGGERED_DISTRIBUTION_PRESETS,
} from '@/lib/designSheetTrustDetails'

describe('trust details design section', () => {
  const trustDetailsSource = fs.readFileSync(
    path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/TrustDetailsSection.tsx'),
    'utf8',
  )

  it('exposes spousal trust funding options in Trust Structure', () => {
    expect(trustDetailsSource).toContain('Spousal Trust Funding')
    expect(trustDetailsSource).toContain('Outright to Spouse')
    expect(trustDetailsSource).toContain('Clayton Election')
    expect(trustDetailsSource).toContain("setTrustPlanningType(prevSheet, value)")
  })

  it('includes trust name quick-fill suggestions and format controls', () => {
    expect(trustDetailsSource).toContain('buildTrustNameSuggestions')
    expect(trustDetailsSource).toContain('Trust Name Format')
    expect(trustDetailsSource).toContain('Append "and any amendments thereto"')
    expect(trustDetailsSource).toContain("scope=\"spouse\"")
  })

  it('captures trustee provisions, residuary, administrative, and definition options', () => {
    expect(trustDetailsSource).not.toContain('Initial Trustee Nomination Structure')
    expect(trustDetailsSource).toContain('Successor Trustee Vacancy')
    expect(trustDetailsSource).toContain('Residual Beneficiary Method')
    expect(trustDetailsSource).toContain('Special Distributions')
    expect(trustDetailsSource).toContain('Administrative Provisions')
    expect(trustDetailsSource).toContain('Definitions')
    expect(trustDetailsSource).toContain('Protect U.S. trust status')
  })

  it('builds joint and separate trust name suggestions', () => {
    expect(buildTrustNameSuggestions(
      { client_name: 'John Smith', spouse_name: 'Jane Smith', is_joint: true },
      { client_name: 'John Smith', spouse_name: 'Jane Smith' },
    )).toEqual([
      'The John and Jane Trust',
      'The John and Jane Revocable Trust',
      'The Smith Family Trust',
    ])
  })

  it('defaults trust detail provisions from decisions JSONB', () => {
    expect(getTrustDetails({ decisions: null }).initial_trustee_nomination).toBe('grantor')
    expect(getTrustDetails({ decisions: null }).trustee_compensation).toBe('reasonable')
  })
})

describe('staggered distribution quick fill', () => {
  const trustDetailsSource = fs.readFileSync(
    path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/TrustDetailsSection.tsx'),
    'utf8',
  )

  it('offers the three standard presets', () => {
    expect(STAGGERED_DISTRIBUTION_PRESETS.map(p => p.label)).toEqual([
      'All at 30',
      '1/2 at 25 and 30',
      '1/3 at 25, 30, 35',
    ])
    expect(STAGGERED_DISTRIBUTION_PRESETS[0].tiers).toEqual([{ amount: 'All', age: 30 }])
    expect(STAGGERED_DISTRIBUTION_PRESETS[1].tiers).toEqual([
      { amount: '1/2', age: 25 },
      { amount: '1/2', age: 30 },
    ])
    expect(STAGGERED_DISTRIBUTION_PRESETS[2].tiers).toEqual([
      { amount: '1/3', age: 25 },
      { amount: '1/3', age: 30 },
      { amount: '1/3', age: 35 },
    ])
  })

  it('builds tiers with fresh ids from a preset', () => {
    let n = 0
    const tiers = buildStaggeredTiersFromPreset(STAGGERED_DISTRIBUTION_PRESETS[2], () => `id-${n++}`)
    expect(tiers).toEqual([
      { id: 'id-0', amount: '1/3', age: 25 },
      { id: 'id-1', amount: '1/3', age: 30 },
      { id: 'id-2', amount: '1/3', age: 35 },
    ])
  })

  it('renders the quick fill controls in the staggered distributions editor', () => {
    expect(trustDetailsSource).toContain('Quick fill:')
    expect(trustDetailsSource).toContain('STAGGERED_DISTRIBUTION_PRESETS.map')
    expect(trustDetailsSource).toContain('buildStaggeredTiersFromPreset(preset')
  })
})
