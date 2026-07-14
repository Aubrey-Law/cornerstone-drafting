import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('lite intake import compatibility', () => {
  it('resolves lead imports against the intake-backed lead row', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'lib/intakeImport/leadIntakeImport.ts'),
      'utf8',
    )
    const leadBranch = source.slice(source.indexOf('if (leadId)'), source.indexOf("} else if (matterId)"))
    expect(source).toContain(".from('client_intake')")
    expect(leadBranch).toContain(".from('client_intake')")
    expect(leadBranch).toContain("clientIntakeId = leadId")
    expect(leadBranch).not.toContain(".from('leads')")
  })

  it('does not select matters.lead_id during matter intake import', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'lib/intakeImport/leadIntakeImport.ts'),
      'utf8',
    )
    expect(source).toContain('MATTER_INTAKE_LINK_COLUMNS')
    expect(source).not.toMatch(/from\('matters'\)[\s\S]*lead_id/)
  })

  it('does not select matters.lead_id when resolving matter intake', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'lib/intake/resolveMatterIntakeId.ts'),
      'utf8',
    )
    expect(source).toContain('MATTER_INTAKE_LINK_COLUMNS')
    expect(source).not.toMatch(/from\('matters'\)[\s\S]*lead_id/)
  })

  it('does not select matters.lead_id in admin intake matter branch', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'app/actions/adminIntake.ts'),
      'utf8',
    )
    const block = source.slice(
      source.indexOf('if (args.matterId)'),
      source.indexOf('if (!args.leadId) throw new Error'),
    )
    expect(block).toContain('MATTER_INTAKE_LINK_COLUMNS')
    expect(block).not.toContain('lead_id')
  })
})
