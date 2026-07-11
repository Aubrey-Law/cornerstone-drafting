import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { buildTrustNameSuggestions, getTrustDetails } from '@/lib/designSheetTrustDetails'

describe('trust details design section', () => {
  const trustDetailsSource = fs.readFileSync(
    path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/TrustDetailsSection.tsx'),
    'utf8',
  )

  it('exposes spousal trust funding options in Trust Structure', () => {
    expect(trustDetailsSource).toContain('Spousal Trust Funding')
    expect(trustDetailsSource).toContain('Outright to Spouse')
    expect(trustDetailsSource).toContain('Clayton Election')
    expect(trustDetailsSource).toContain("setTrustPlanningType(prevSheet, option.value)")
  })

  it('includes trust name quick-fill suggestions and format controls', () => {
    expect(trustDetailsSource).toContain('buildTrustNameSuggestions')
    expect(trustDetailsSource).toContain('Trust Name Format')
    expect(trustDetailsSource).toContain('Append "and any amendments thereto"')
    expect(trustDetailsSource).toContain("scope=\"spouse\"")
  })

  it('captures trustee provisions, residuary, administrative, and definition options', () => {
    expect(trustDetailsSource).toContain('Initial Trustee Nomination Structure')
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
