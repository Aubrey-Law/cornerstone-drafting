import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('design sheet plan-specific UI cleanup', () => {
  it('keeps retired family-provision clutter out of the Trust document section', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/DocumentSections.tsx'),
      'utf8',
    )

    expect(source).not.toContain('<SectionBlock title="Family Inclusions">')
    expect(source).not.toContain('<SectionBlock title="Special Provisions">')
    expect(source).not.toContain("onChange('include_afterborn_children'")
    expect(source).not.toContain("onChange('include_expectant_children'")
    expect(source).not.toContain("onChange('include_general_disinheritance'")
    expect(source).not.toContain("onChange('include_common_disaster'")
    expect(source).not.toContain("onChange('include_guardians_allowance'")
    expect(source).not.toContain("onChange('beneficiary_as_cotrustee'")
    expect(source).not.toContain("onChange('beneficiary_as_sole_trustee'")
    expect(source).not.toContain("onChange('remote_beneficiary'")
    expect(source).not.toContain("onChange('provision_lifestyle_disability'")
    expect(source).not.toContain("onChange('provision_substance_abuse'")
    expect(source).not.toContain("onChange('provision_married_beneficiary'")
  })

  it('restores trust distribution and tangible personal property controls to the Trust document section', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/DocumentSections.tsx'),
      'utf8',
    )
    const trustSection = source.slice(
      source.indexOf('export function TrustDetailsSection'),
      source.indexOf('export function TrustDocumentSection'),
    )

    expect(trustSection).toContain('<SectionBlock title="Residuary Distribution">')
    expect(trustSection).toContain("onChange('distribution_method'")
    expect(trustSection).toContain("onChange('residual_beneficiary'")
    expect(trustSection).toContain("onChange('staggered_distributions'")
    // Tangible personal property is centralized in Plan Design now, not Trust.
    expect(trustSection).not.toContain('Tangible Personal Property')
  })

  it('centralizes tangible personal property in Plan Design, not Will or Trust', () => {
    const plan = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/PlanDesignSection.tsx'),
      'utf8',
    )
    const will = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/WillProvisionsSection.tsx'),
      'utf8',
    )

    expect(plan).toContain('<SectionBlock title="Tangible Personal Property">')
    expect(plan).toContain("onChange('tangible_property_distribution'")
    expect(plan).toContain("onChange('tangible_property_named_individual'")
    expect(plan).toContain("value: 'spouse_then_children'")
    expect(plan).toContain("value: 'memorandum'")
    expect(will).not.toContain('Tangible Personal Property')
  })
})
