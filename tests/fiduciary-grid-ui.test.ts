import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

describe('fiduciary grid UI', () => {
  it('uses an overflow-safe roster-plus-roles grid and existing slot helpers', () => {
    const source = read('app/admin/drafting/[matterId]/design/sections/FiduciaryGrid.tsx')

    // Column count follows the roles being rendered — the matrix is used twice, once
    // for the per-party roles and once for the shared child-related ones.
    expect(source).toContain('`168px repeat(${roles.length}, minmax(96px, 1fr))`')
    expect(source).toContain('overflow-x-auto')
    expect(source).toContain('removeFiduciaryContact')
    expect(source).toContain('movePrincipalSlot')
    expect(source).toContain('normalizeFiduciarySlots')
    expect(source).toContain('PartyTabs')
    expect(source).toContain('Mirror reversed')
    expect(source).toContain('Contact roster')
    expect(source).toContain('roster.map')
  })

  it('removes document-level nomination pickers and legacy shortcuts', () => {
    const documents = read('app/admin/drafting/[matterId]/design/sections/DocumentSections.tsx')
    const trust = read('app/admin/drafting/[matterId]/design/sections/TrustDetailsSection.tsx')

    expect(documents).not.toContain('<DpoaFiduciarySections')
    expect(trust).not.toContain('trusteesOnly')
    expect(documents).not.toContain('<FiduciaryBlock')
    expect(trust).not.toContain('<FiduciaryBlock')
    expect(fs.existsSync(path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/documentFiduciarySections.tsx'))).toBe(false)
    expect(fs.existsSync(path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/FiduciariesSectionEP.tsx'))).toBe(false)
    expect(fs.existsSync(path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/FiduciariesSectionLP.tsx'))).toBe(false)
  })
})
