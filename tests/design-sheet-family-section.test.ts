import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('family information design section', () => {
  const sectionsDir = path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections')
  const readSection = (name: string) => fs.readFileSync(path.join(sectionsDir, name), 'utf8')

  /**
   * Every section file at once.
   *
   * These groups started in FamilySection and have since been split across
   * PersonalSection and PlanStructureFactsSection. Which file renders a group
   * is a layout decision; what these tests are protecting is that the group is
   * still rendered with its fields wired up. Reading one filename turned a
   * refactor into four failures that named no real regression.
   */
  const familySource = fs
    .readdirSync(sectionsDir)
    .filter(name => name.endsWith('.tsx'))
    .map(readSection)
    .join('\n')

  // Remote beneficiaries and specific bequests belong under Trust Details, so
  // the negative assertions below stay scoped to the file that owns the
  // additional-beneficiaries group — across all sections they would find the
  // Trust Details copy and fail by design.
  const additionalBeneficiariesSource = readSection('PlanStructureFactsSection.tsx')
  const trustBeneficiariesSource = fs.readFileSync(
    path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/TrustBeneficiariesSection.tsx'),
    'utf8',
  )
  const trustDetailsSource = fs.readFileSync(
    path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/TrustDetailsSection.tsx'),
    'utf8',
  )

  it('captures children with gender and deceased status', () => {
    expect(familySource).toContain('title="Children"')
    // The subtitle naming deceased children from previous marriages was cut in
    // #203. Capturing the status is the part that matters and is asserted just
    // below, so this now checks the field rather than the prose around it.
    expect(familySource).toContain('updateChild(idx, { deceased:')
    expect(familySource).toContain('label="Gender"')
    expect(familySource).toContain('label="Deceased"')
    expect(familySource).toContain('Add Child')
  })

  it('exposes children option toggles in Family Information', () => {
    expect(familySource).toContain('title="Children Options"')
    expect(familySource).toContain("onChange('include_child_gender_markers'")
    expect(familySource).toContain("onChange('include_afterborn_children'")
    expect(familySource).toContain("onChange('include_expectant_children'")
    expect(familySource).toContain("onChange('omissions_intentional'")
  })

  it('centralizes disinherited heirs in Family Information', () => {
    expect(familySource).toContain('title="Disinherited Heirs"')
    expect(familySource).toContain('Disinherited Children')
    expect(familySource).toContain('Add Disinherited Heir')
    expect(familySource).toContain("onChange('disinherit_issue'")
    expect(familySource).toContain("onChange('include_general_disinheritance'")
    expect(familySource).toContain('Additional Disinheritance Language')
    expect(familySource).toContain('Clause Library')
    expect(familySource).toContain('Draft with AI')
  })

  it('lists additional beneficiaries in Family Information', () => {
    expect(familySource).toContain('title="Additional Beneficiaries"')
    expect(familySource).toContain("onChange('include_additional_beneficiaries'")
    expect(familySource).toContain("onChange('additional_beneficiaries'")
    expect(familySource).toContain('residual distribution')
    expect(additionalBeneficiariesSource).not.toContain('Remote Beneficiaries')
    expect(additionalBeneficiariesSource).not.toContain('Specific Bequests')
  })

  it('places remote beneficiaries and specific bequests under Trust Details', () => {
    expect(trustBeneficiariesSource).toContain('title="Remote Beneficiaries"')
    expect(trustBeneficiariesSource).toContain('title="Specific Bequests"')
    expect(trustDetailsSource).toContain('<TrustBeneficiariesSection')
  })
})
